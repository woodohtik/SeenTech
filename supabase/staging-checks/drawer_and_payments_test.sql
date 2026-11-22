-- seen-readiness-fixes-task.md P1.3 (20270102000003). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/drawer_and_payments_test.sql
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  B uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  cash text := gen_random_uuid()::text;
  s_own uuid := gen_random_uuid();
  s_cash uuid := gen_random_uuid();
  sh_own uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  o1 uuid; o2 uuid;
  v jsonb;
  checks int := 0;
  hint text;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vat_number, is_tax_enabled, default_tax_rate)
  VALUES (T, 'درج', 'drawer@example.invalid', '0500000010', 'active', true, '300000000000003', true, 15);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (B, T, 'main', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test) VALUES
    (s_own, T, own, 'owner', 'dr-own@example.invalid', 'owner', B, 'active', true),
    (s_cash, T, cash, 'cashier', 'dr-cash@example.invalid', 'cashier', B, 'active', true);
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
  VALUES (sh_own, T, B, s_own, 'owner', 0, 'open', now());
  INSERT INTO public.customers (id, tenant_id, name, phone, is_test) VALUES (c, T, 'c', '0500000011', true);
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v := public.create_tailoring_order(gen_random_uuid(),
    jsonb_build_object('customer_id', c, 'paid_amount', 0, 'status', 'measurements_taken', 'status_key', 'measurements_taken'),
    '[{"garment_type":"ثوب","quantity":1,"price":100}]'::jsonb);
  o1 := (v->'order'->>'id')::uuid;
  v := public.create_tailoring_order(gen_random_uuid(),
    jsonb_build_object('customer_id', c, 'paid_amount', 0, 'status', 'measurements_taken', 'status_key', 'measurements_taken'),
    '[{"garment_type":"ثوب","quantity":1,"price":100}]'::jsonb);
  o2 := (v->'order'->>'id')::uuid;
  RESET ROLE;

  -- 1. The cashier has no open shift: her payment is refused, not left outside every drawer.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cash, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_order_payment(gen_random_uuid(), o1, 10, 'cash', NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'FAIL a payment with no shift was taken';
  EXCEPTION WHEN SQLSTATE '22023' THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
    IF hint <> 'no_open_shift' THEN RAISE EXCEPTION 'FAIL wrong refusal: %', hint; END IF;
  END;
  checks := checks + 1;
  -- 2. Nor on the owner's shift.
  BEGIN
    PERFORM public.record_order_payment(gen_random_uuid(), o1, 10, 'cash', sh_own, NULL, NULL, NULL);
    RAISE EXCEPTION 'FAIL a payment went on a colleague''s shift';
  EXCEPTION WHEN SQLSTATE '22023' THEN checks := checks + 1;
  END;
  RESET ROLE;

  -- 3. The owner, no shift passed: it goes on her own open shift.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.record_order_payment(gen_random_uuid(), o1, 10, 'cash', NULL, NULL, NULL, NULL);
  IF EXISTS (SELECT 1 FROM public.payments WHERE order_id = o1 AND shift_id IS DISTINCT FROM sh_own) THEN
    RAISE EXCEPTION 'FAIL the payment is not on the owner''s shift';
  END IF;
  checks := checks + 1;

  -- 4. "Pay and deliver" may only deliver.
  BEGIN
    PERFORM public.record_order_payment(gen_random_uuid(), o1, 105, 'cash', sh_own, NULL, 'ready', 'ready');
    RAISE EXCEPTION 'FAIL a payment moved the order to ready';
  EXCEPTION WHEN SQLSTATE '22023' THEN checks := checks + 1;
  END;
  PERFORM public.record_order_payment(gen_random_uuid(), o1, 105, 'cash', sh_own, NULL, 'delivered', 'delivered');
  IF (SELECT status::text FROM public.orders WHERE id = o1) <> 'delivered' THEN RAISE EXCEPTION 'FAIL pay and deliver'; END IF;
  checks := checks + 1;

  -- 5. No money on a cancelled order.
  PERFORM public.update_order_status(o2, 'cancelled', 'cancelled', NULL, gen_random_uuid(), NULL);
  BEGIN
    PERFORM public.record_order_payment(gen_random_uuid(), o2, 10, 'cash', sh_own, NULL, NULL, NULL);
    RAISE EXCEPTION 'FAIL a payment was taken on a cancelled order';
  EXCEPTION WHEN SQLSTATE '22023' THEN checks := checks + 1;
  END;

  -- 6. A partial POS sale: the 50 paid now is cash, and the shift's expected cash counts it.
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh_own, 'customer_name', 'W', 'status', 'delivered', 'payment_method', 'partial', 'paid_amount', 50, 'delivery_date', now()::text),
    '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
  IF (SELECT method::text FROM public.payments WHERE order_id = (v->>'order_id')::uuid) <> 'cash' THEN
    RAISE EXCEPTION 'FAIL the partial sale''s cash is not cash';
  END IF;
  checks := checks + 1;

  -- 7. A credit note can give back only what was paid: the partial sale paid 50 of 115.
  BEGIN
    PERFORM public.issue_credit_note(gen_random_uuid(), (SELECT id FROM public.tax_invoices WHERE order_id = (v->>'order_id')::uuid), 115, 'x', 'cash');
    RAISE EXCEPTION 'FAIL a credit note refunded more than was paid';
  EXCEPTION WHEN SQLSTATE '23514' THEN checks := checks + 1;
  END;
  PERFORM public.issue_credit_note(gen_random_uuid(), (SELECT id FROM public.tax_invoices WHERE order_id = (v->>'order_id')::uuid), 50, 'x', 'cash');
  IF (SELECT shift_id FROM public.sales_returns WHERE order_id = (v->>'order_id')::uuid) IS DISTINCT FROM sh_own THEN
    RAISE EXCEPTION 'FAIL the cash refund is not on the issuer''s shift';
  END IF;
  checks := checks + 1;
  RESET ROLE;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
