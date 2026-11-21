-- Selling by length (seen-verticals-readiness-task.md Phase 5): 2.5 m from a
-- 30 m roll leaves 27.5 m; the line keeps 2.5 at 'meter'; the price is per
-- metre; returning the 2.5 m puts the stock back to 30. Rolled back.
--   npx supabase db query --linked --file supabase/tests/pos_sale_by_length_test.sql
DO $test$
DECLARE
  o record;
  v_branch uuid;
  v_shift uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_res jsonb;
  v_left numeric;
  v_line record;
  checks int := 0;
BEGIN
  SELECT t.id AS tenant_id, s.id AS staff_id, s.uid
    INTO o
    FROM public.tenants t
    JOIN public.staff s ON s.tenant_id = t.id AND s.uid = t.owner_uid
    JOIN public.users u ON u.id = s.uid
   WHERE s.status = 'active'
     AND EXISTS (SELECT 1 FROM public.orders x WHERE x.tenant_id = t.id)
   ORDER BY t.created_at LIMIT 1;
  SELECT id INTO v_branch FROM public.branches WHERE tenant_id = o.tenant_id ORDER BY is_main DESC NULLS LAST LIMIT 1;
  IF o.staff_id IS NULL OR v_branch IS NULL THEN RAISE EXCEPTION 'SKIP: need an owner with a branch'; END IF;

  -- As the system: an open shift for the owner, and a 30 m cotton roll at 20 / m.
  SET LOCAL session_replication_role = replica;
  UPDATE public.shifts SET status = 'closed' WHERE tenant_id = o.tenant_id AND staff_id = o.staff_id AND status = 'open';
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, status, start_time)
  VALUES (v_shift, o.tenant_id, v_branch, o.staff_id, 'اختبار', 'open', now());
  INSERT INTO public.inventory_items (id, tenant_id, name, sku, category, category_key, unit, base_unit, conversion_rate, price_per_unit, min_threshold)
  VALUES (v_item, o.tenant_id, 'قطن اختبار', 'TEST-LEN-' || left(v_item::text, 8), 'other', 'cotton', 'roll', 'meter', 30, 20, 0);
  INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity)
  VALUES (o.tenant_id, v_branch, v_item, 30);
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', o.uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', o.uid::text, true);
  SET LOCAL ROLE authenticated;
  v_res := public.create_pos_sale(
    gen_random_uuid(),
    jsonb_build_object('shift_id', v_shift, 'customer_name', 'عميل', 'status', 'delivered', 'payment_method', 'cash',
                       'paid_amount', 57.5, 'delivery_date', now()),
    jsonb_build_array(jsonb_build_object('type', 'ready_made', 'item_id', v_item, 'name', 'قطن اختبار',
                                         'quantity', 2.5, 'selected_unit', 'meter', 'price', 20)),
    '{}'::jsonb);
  RESET ROLE;

  SELECT quantity INTO v_left FROM public.branch_inventory WHERE item_id = v_item AND branch_id = v_branch;
  IF v_left <> 27.5 THEN RAISE EXCEPTION 'FAIL: % m left, expected 27.5', v_left; END IF;
  checks := checks + 1;

  SELECT quantity, selected_unit::text AS unit, price INTO v_line FROM public.order_items WHERE item_id = v_item;
  IF v_line.quantity <> 2.5 OR v_line.unit <> 'meter' OR v_line.price <> 20 THEN
    RAISE EXCEPTION 'FAIL: line %', row_to_json(v_line);
  END IF;
  checks := checks + 1;

  -- A return of the 2.5 m puts it back (decimal quantity, Phase 5.4).
  SET LOCAL ROLE authenticated;
  PERFORM public.process_sales_return(
    gen_random_uuid(), (v_res->>'order_id')::uuid, v_shift,
    jsonb_build_array(jsonb_build_object('order_item_id', (SELECT id FROM public.order_items WHERE item_id = v_item), 'quantity', 2.5)),
    'اختبار', 'cash');
  RESET ROLE;
  SELECT quantity INTO v_left FROM public.branch_inventory WHERE item_id = v_item AND branch_id = v_branch;
  IF v_left <> 30 THEN RAISE EXCEPTION 'FAIL: % m after the return, expected 30', v_left; END IF;
  checks := checks + 1;

  RAISE EXCEPTION 'PASS: % checks (sale %)', checks, v_res->>'order_id';
END
$test$;
