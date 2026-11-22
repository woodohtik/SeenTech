-- seen-readiness-fixes-task.md P4 (20270105000007). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/fabric_shortage_test.sql
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  BR uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  cas text := gen_random_uuid()::text;
  s_own uuid := gen_random_uuid();
  sh uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  fab uuid := gen_random_uuid();
  v jsonb;
  o uuid;
  msg text; hint text;
  checks int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES (T, 'قماش', 'fs@example.invalid', '0500000021', 'active', true);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (BR, T, 'main', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test) VALUES
    (s_own, T, own, 'owner', 'fs-own@example.invalid', 'owner', BR, 'active', true),
    (gen_random_uuid(), T, cas, 'cashier', 'fs-cas@example.invalid', 'cashier', BR, 'active', true);
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
  VALUES (sh, T, BR, s_own, 'owner', 0, 'open', now());
  INSERT INTO public.customers (id, tenant_id, name, phone, is_test) VALUES (c, T, 'c', '0500000022', true);
  INSERT INTO public.inventory_items (id, tenant_id, name, sku, category, category_key, unit, base_unit, conversion_rate, price_per_unit, min_threshold)
  VALUES (fab, T, 'قطن أبيض', 'FS-' || left(fab::text, 6), 'fabric', 'cotton', 'meter', 'meter', 1, 20, 0);
  INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity) VALUES (T, BR, fab, 1);
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v := public.create_tailoring_order(gen_random_uuid(),
    jsonb_build_object('customer_id', c, 'paid_amount', 0, 'payment_method', 'cash', 'status', 'measurements_taken', 'status_key', 'measurements_taken'),
    jsonb_build_array(jsonb_build_object('garment_type', 'ثوب', 'quantity', 1, 'price', 200, 'fabric_id', fab, 'consumed_meters', 3)));
  o := (v->'order'->>'id')::uuid;

  -- 1. Cutting with 1 m of 3 m: refused, saying what is short.
  BEGIN
    PERFORM public.update_order_status(o, 'cutting', 'cutting', NULL, gen_random_uuid(), NULL);
    RAISE EXCEPTION 'FAIL moved with short fabric';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT, hint = PG_EXCEPTION_HINT;
    IF hint <> 'fabric_shortage' OR msg NOT LIKE '%قطن أبيض%' OR msg NOT LIKE '%3%' THEN RAISE EXCEPTION 'FAIL unclear refusal: % / %', msg, hint; END IF;
    checks := checks + 1;
  END;

  -- 2. A cashier cannot go on anyway.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cas, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.continue_with_fabric_shortage(o, 'cutting', 'cutting', NULL, gen_random_uuid(), NULL, NULL, 'لازم');
    RAISE EXCEPTION 'FAIL a cashier went on';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;

  -- 3. The owner goes on with a reason: 1 m deducted, 2 m kept as a shortage, the order moved.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  v := public.continue_with_fabric_shortage(o, 'cutting', 'cutting', NULL, gen_random_uuid(), NULL, NULL, 'وصلت الشحنة ولم تُسجَّل');
  RESET ROLE;
  IF (SELECT status::text FROM public.orders WHERE id = o) <> 'cutting'
     OR (SELECT quantity FROM public.branch_inventory WHERE branch_id = BR AND item_id = fab) <> 0
     OR (SELECT needed - deducted FROM public.fabric_shortages WHERE order_id = o) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.order_history WHERE order_id = o AND notes LIKE '%تابع رغم نقص القماش%') THEN
    RAISE EXCEPTION 'FAIL continue: status %, stock %, short %',
      (SELECT status FROM public.orders WHERE id = o),
      (SELECT quantity FROM public.branch_inventory WHERE branch_id = BR AND item_id = fab),
      (SELECT needed - deducted FROM public.fabric_shortages WHERE order_id = o);
  END IF;
  checks := checks + 3;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
