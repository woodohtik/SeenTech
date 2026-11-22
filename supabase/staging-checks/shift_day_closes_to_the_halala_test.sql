-- seen-readiness-fixes-task.md P1 acceptance: closing a shift after a sample
-- day matches counting the drawer by hand. Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/shift_day_closes_to_the_halala_test.sql
--
-- The day (opening 200):
--   cash sale 115 (in) . network sale 57.50 (not in the drawer)
--   partial sale: 230 total, 60 cash now (in) . tailoring deposit 50 (in)
--   payment on that order 40 cash (in) . credit note on the cash sale 23 (out)
--   cancel the partial-paid tailoring order: 90 back (out)
-- By hand: 200 + 115 + 60 + 50 + 40 - 23 - 90 = 352.
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  B uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  s_own uuid := gen_random_uuid();
  sh uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  v jsonb;
  o_cash uuid; o_tail uuid;
  closed jsonb;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vat_number, is_tax_enabled, default_tax_rate)
  VALUES (T, 'يوم', 'day@example.invalid', '0500000003', 'active', true, '300000000000003', true, 15);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (B, T, 'main', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test)
  VALUES (s_own, T, own, 'owner', 'day-own@example.invalid', 'owner', B, 'active', true);
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
  VALUES (sh, T, B, s_own, 'owner', 200, 'open', now());
  INSERT INTO public.customers (id, tenant_id, name, phone, is_test) VALUES (c, T, 'c', '0500000004', true);
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh, 'customer_name', 'W', 'status', 'delivered', 'payment_method', 'cash', 'paid_amount', 115, 'delivery_date', now()::text),
    '[{"type":"custom","name":"a","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
  o_cash := (v->>'order_id')::uuid;
  PERFORM public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh, 'customer_name', 'W', 'status', 'delivered', 'payment_method', 'network', 'paid_amount', 57.5, 'delivery_date', now()::text),
    '[{"type":"custom","name":"b","price":50,"quantity":1}]'::jsonb, '{}'::jsonb);
  PERFORM public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh, 'customer_name', 'W', 'status', 'delivered', 'payment_method', 'partial', 'paid_amount', 60, 'delivery_date', now()::text),
    '[{"type":"custom","name":"c","price":200,"quantity":1}]'::jsonb, '{}'::jsonb);
  v := public.create_tailoring_order(gen_random_uuid(),
    jsonb_build_object('customer_id', c, 'paid_amount', 50, 'payment_method', 'cash', 'status', 'measurements_taken', 'status_key', 'measurements_taken'),
    '[{"garment_type":"ثوب","quantity":1,"price":200}]'::jsonb);
  o_tail := (v->'order'->>'id')::uuid;
  PERFORM public.record_order_payment(gen_random_uuid(), o_tail, 40, 'cash', NULL, NULL, NULL, NULL);
  PERFORM public.issue_credit_note(gen_random_uuid(), (SELECT id FROM public.tax_invoices WHERE order_id = o_cash), 23, 'جزء', 'cash');
  PERFORM public.cancel_order(gen_random_uuid(), o_tail, 'العميل عدل');
  closed := public.close_shift(gen_random_uuid(), sh, 352, NULL);
  RESET ROLE;

  IF (closed->>'expected_cash')::numeric <> 352 OR (closed->>'discrepancy')::numeric <> 0 THEN
    RAISE EXCEPTION 'FAIL the drawer: expected % (by hand 352), discrepancy %', closed->>'expected_cash', closed->>'discrepancy';
  END IF;
  RAISE EXCEPTION 'PASS: the shift closes at 352, to the halala (%)', closed->'totals';
END
$test$;
