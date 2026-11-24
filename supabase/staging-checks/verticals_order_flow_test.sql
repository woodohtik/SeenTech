-- seen-verticals-readiness-task.md Phase 8: one order through every stage, in
-- every vertical, the way the app drives it (create_tailoring_order,
-- update_order_status with the stage's legacy_status, record_order_payment),
-- as a real shop owner. Rolled back at the end -- nothing stays.
--   npx supabase db query --linked --file supabase/staging-checks/verticals_order_flow_test.sql
--
-- At every stage it checks:
--   - orders.status is the stage's legacy_status (no stage before "ready" is
--     stored as ready);
--   - the fabric line's 2 m leave the stock exactly at the stage that
--     consumes materials, not before (verticals that use fabric);
--   - get_dashboard_stats' ready / in-progress counts equal a count of the
--     shop's orders by order_phase.
-- And that the line's specs (attributes) are kept.
DO $test$
DECLARE
  o record;
  v_branch uuid;
  v_shift uuid := gen_random_uuid();
  v_cust uuid := gen_random_uuid();
  v_fabric uuid := gen_random_uuid();
  vk text;
  st record;
  v_order uuid;
  v_res jsonb;
  v_stock numeric;
  v_consumed boolean;
  v_status text;
  v_total numeric;
  v_paid numeric;
  v_dash jsonb;
  v_manual_ready int;
  v_manual_prog int;
  v_uses_fabric boolean;
  v_first text;
  report text := '';
  checks int := 0;
BEGIN
  SELECT t.id AS tenant_id, s.id AS staff_id, s.uid INTO o
    FROM public.tenants t
    JOIN public.staff s ON s.tenant_id = t.id AND s.uid = t.owner_uid
    JOIN public.users u ON u.id = s.uid
   WHERE s.status = 'active' AND EXISTS (SELECT 1 FROM public.orders x WHERE x.tenant_id = t.id)
   ORDER BY t.created_at LIMIT 1;
  SELECT id INTO v_branch FROM public.branches WHERE tenant_id = o.tenant_id ORDER BY is_main DESC NULLS LAST LIMIT 1;
  IF o.staff_id IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'SKIP: need an owner with a branch'; END IF;

  -- As the system: an open shift, a customer, a 100 m fabric.
  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET status = 'closed' WHERE tenant_id = o.tenant_id AND staff_id = o.staff_id AND status = 'open';
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, status, start_time)
  VALUES (v_shift, o.tenant_id, v_branch, o.staff_id, 'اختبار', 'open', now());
  INSERT INTO public.customers (id, tenant_id, name, phone, is_test) VALUES (v_cust, o.tenant_id, 'عميل اختبار الأنشطة', '0500000001', true);
  INSERT INTO public.inventory_items (id, tenant_id, name, sku, category, category_key, unit, base_unit, conversion_rate, price_per_unit, min_threshold)
  VALUES (v_fabric, o.tenant_id, 'قماش اختبار الأنشطة', 'TEST-VFLOW-' || left(v_fabric::text, 8), 'fabric', 'fabric', 'meter', 'meter', 1, 10, 0);
  INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity) VALUES (o.tenant_id, v_branch, v_fabric, 100);
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', o.uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', o.uid::text, true);

  FOR vk IN SELECT key FROM public.verticals ORDER BY sort LOOP
    SET LOCAL session_replication_role = replica;
    UPDATE public.tenants SET vertical = vk WHERE id = o.tenant_id;
    UPDATE public.branch_inventory SET quantity = 100 WHERE item_id = v_fabric AND branch_id = v_branch;
    SET LOCAL session_replication_role = origin;
    v_uses_fabric := coalesce((SELECT (capabilities->>'fabric_consumption')::boolean FROM public.verticals WHERE key = vk), false);
    SELECT stage_key INTO v_first FROM public.vertical_workflow_stages WHERE vertical_key = vk ORDER BY sort LIMIT 1;

    -- Create the order at the first stage, with a spec and (when used) 2 m of fabric.
    SET LOCAL ROLE authenticated;
    v_res := public.create_tailoring_order(gen_random_uuid(),
      jsonb_build_object('customer_id', v_cust, 'paid_amount', 0, 'is_test', true,
                         'status', (SELECT legacy_status::text FROM public.vertical_workflow_stages WHERE vertical_key = vk AND stage_key = v_first),
                         'status_key', v_first),
      jsonb_build_array(jsonb_build_object('garment_type', 'قطعة', 'quantity', 1, 'price', 100,
        'fabric_id', CASE WHEN v_uses_fabric THEN v_fabric::text ELSE '' END,
        'consumed_meters', CASE WHEN v_uses_fabric THEN 2 ELSE 0 END,
        'attributes', jsonb_build_object('color', 'أزرق'))));
    RESET ROLE;
    v_order := (v_res->'order'->>'id')::uuid;
    IF (SELECT attributes->>'color' FROM public.order_items WHERE order_id = v_order LIMIT 1) IS DISTINCT FROM 'أزرق' THEN
      RAISE EXCEPTION 'FAIL %: the line spec was not kept', vk;
    END IF;

    -- Every following stage, in order (cancelled is not a stage of the flow).
    FOR st IN SELECT stage_key, legacy_status::text AS legacy, phase, consumes_materials, sort
                FROM public.vertical_workflow_stages
               WHERE vertical_key = vk AND phase <> 'cancelled' AND stage_key <> v_first
               ORDER BY sort LOOP
      IF st.phase = 'delivered' THEN
        -- Settle the order before delivery, as the order screen does.
        SELECT total_amount, paid_amount INTO v_total, v_paid FROM public.orders WHERE id = v_order;
        IF v_total > v_paid THEN
          SET LOCAL ROLE authenticated;
          PERFORM public.record_order_payment(gen_random_uuid(), v_order, v_total - v_paid, 'cash', v_shift, NULL, NULL, NULL);
          RESET ROLE;
        END IF;
      END IF;
      SET LOCAL ROLE authenticated;
      PERFORM public.update_order_status(v_order, st.legacy, st.stage_key, NULL, gen_random_uuid(), NULL);
      RESET ROLE;

      SELECT status::text INTO v_status FROM public.orders WHERE id = v_order;
      IF v_status <> st.legacy THEN RAISE EXCEPTION 'FAIL %/%: stored % instead of %', vk, st.stage_key, v_status, st.legacy; END IF;
      IF v_status = 'ready' AND st.phase <> 'ready' THEN RAISE EXCEPTION 'FAIL %/%: stored ready before the ready stage', vk, st.stage_key; END IF;

      IF v_uses_fabric THEN
        SELECT quantity INTO v_stock FROM public.branch_inventory WHERE item_id = v_fabric AND branch_id = v_branch;
        -- consumed once the order has reached the consuming stage (by sort)
        v_consumed := st.sort >= (SELECT sort FROM public.vertical_workflow_stages WHERE vertical_key = vk AND consumes_materials);
        IF v_consumed AND v_stock <> 98 THEN RAISE EXCEPTION 'FAIL %/%: fabric % (expected 98)', vk, st.stage_key, v_stock; END IF;
        IF NOT v_consumed AND v_stock <> 100 THEN RAISE EXCEPTION 'FAIL %/%: fabric deducted early (%)', vk, st.stage_key, v_stock; END IF;
      END IF;

      IF st.phase IN ('ready', 'in_progress') THEN
        SET LOCAL ROLE authenticated;
        v_dash := public.get_dashboard_stats(o.tenant_id, NULL, '[]'::jsonb, NULL, NULL);
        RESET ROLE;
        SELECT count(*) FILTER (WHERE public.order_phase(vk, x.status_key, x.status::text) = 'ready'),
               count(*) FILTER (WHERE public.order_phase(vk, x.status_key, x.status::text) NOT IN ('ready', 'delivered', 'cancelled'))
          INTO v_manual_ready, v_manual_prog
          FROM public.orders x WHERE x.tenant_id = o.tenant_id AND NOT coalesce(x.is_test, false);  -- the dashboard leaves test orders out
        IF (v_dash->'totals'->>'ready')::int <> v_manual_ready OR (v_dash->'totals'->>'in_progress')::int <> v_manual_prog THEN
          RAISE EXCEPTION 'FAIL %/%: dashboard ready/in-progress %/% vs counted %/%', vk, st.stage_key,
            v_dash->'totals'->>'ready', v_dash->'totals'->>'in_progress', v_manual_ready, v_manual_prog;
        END IF;
      END IF;
      checks := checks + 1;
    END LOOP;

    IF (SELECT status::text FROM public.orders WHERE id = v_order) <> 'delivered' THEN
      RAISE EXCEPTION 'FAIL %: not delivered at the end', vk;
    END IF;
    report := report || format('%s: %s stages OK%s; ', vk,
      (SELECT count(*) FROM public.vertical_workflow_stages WHERE vertical_key = vk AND phase <> 'cancelled'),
      CASE WHEN v_uses_fabric THEN ', fabric at the consuming stage' ELSE '' END);
  END LOOP;

  RAISE EXCEPTION 'PASS: % stage moves -- %', checks, report;
END
$test$;
