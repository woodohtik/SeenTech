-- seen-readiness-fixes-task.md P4 (20270105000002). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/order_customer_guards_test.sql
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  BR uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  s_own uuid := gen_random_uuid();
  sh uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  v jsonb;
  o_paid uuid; o_free uuid; o_sale uuid;
  n int;
  checks int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vat_number, is_tax_enabled, default_tax_rate)
  VALUES (T, 'حماية', 'guard@example.invalid', '0500000013', 'active', true, '300000000000003', true, 15);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (BR, T, 'main', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test)
  VALUES (s_own, T, own, 'owner', 'guard-own@example.invalid', 'owner', BR, 'active', true);
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
  VALUES (sh, T, BR, s_own, 'owner', 0, 'open', now());
  INSERT INTO public.customers (id, tenant_id, name, phone, is_test) VALUES
    (c, T, 'c', '0500000014', true), (c2, T, 'c2', '0500000015', true);
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v := public.create_tailoring_order(gen_random_uuid(),
    jsonb_build_object('customer_id', c, 'paid_amount', 50, 'payment_method', 'cash', 'status', 'measurements_taken', 'status_key', 'measurements_taken'),
    '[{"garment_type":"ثوب","quantity":1,"price":200}]'::jsonb);
  o_paid := (v->'order'->>'id')::uuid;
  v := public.create_tailoring_order(gen_random_uuid(),
    jsonb_build_object('customer_id', c2, 'paid_amount', 0, 'payment_method', 'cash', 'status', 'measurements_taken', 'status_key', 'measurements_taken'),
    '[{"garment_type":"ثوب","quantity":1,"price":100}]'::jsonb);
  o_free := (v->'order'->>'id')::uuid;

  -- 1. An order with money on it is not deleted; one with nothing is.
  BEGIN
    DELETE FROM public.orders WHERE id = o_paid;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE EXCEPTION 'FAIL an order with a payment was deleted'; END IF;
  EXCEPTION WHEN invalid_parameter_value THEN checks := checks + 1;
  END;
  -- 2. A customer with an open order is not deleted.
  BEGIN
    DELETE FROM public.customers WHERE id = c;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE EXCEPTION 'FAIL a customer with an open order was deleted'; END IF;
  EXCEPTION WHEN invalid_parameter_value THEN checks := checks + 1;
  END;
  DELETE FROM public.orders WHERE id = o_free;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 1 OR EXISTS (SELECT 1 FROM public.orders WHERE id = o_free) THEN
    RAISE EXCEPTION 'FAIL an order with nothing on it was not deleted (% rows)', n;
  END IF;
  checks := checks + 1;

  -- 3. The invoice's paid amount follows the order's, from any screen.
  SET LOCAL ROLE authenticated;
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh, 'customer_id', c, 'customer_name', 'c', 'status', 'delivered', 'payment_method', 'partial', 'paid_amount', 50, 'delivery_date', now()::text),
    '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
  o_sale := (v->>'order_id')::uuid;
  PERFORM public.record_order_payment(gen_random_uuid(), o_sale, 30, 'cash', NULL, NULL, NULL, NULL);
  RESET ROLE;
  IF (SELECT paid_amount FROM public.tax_invoices WHERE order_id = o_sale) <> (SELECT paid_amount FROM public.orders WHERE id = o_sale)
     OR (SELECT paid_amount FROM public.orders WHERE id = o_sale) <> 80 THEN
    RAISE EXCEPTION 'FAIL invoice paid % vs order %',
      (SELECT paid_amount FROM public.tax_invoices WHERE order_id = o_sale), (SELECT paid_amount FROM public.orders WHERE id = o_sale);
  END IF;
  checks := checks + 1;

  -- 4. The platform deleting a whole shop is not blocked.
  DELETE FROM public.tenants WHERE id = T;
  IF EXISTS (SELECT 1 FROM public.orders WHERE tenant_id = T) THEN RAISE EXCEPTION 'FAIL the shop''s orders were kept'; END IF;
  checks := checks + 1;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
