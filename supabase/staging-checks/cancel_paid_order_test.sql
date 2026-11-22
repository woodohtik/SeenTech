-- seen-readiness-fixes-task.md P1.4 (20270102000004). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/cancel_paid_order_test.sql
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  B uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  cash text := gen_random_uuid()::text;
  s_own uuid := gen_random_uuid();
  s_cash uuid := gen_random_uuid();
  sh_own uuid := gen_random_uuid();
  sh_cash uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  o_paid uuid; o_free uuid; o_pos uuid;
  v jsonb;
  hint text;
  checks int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vat_number, is_tax_enabled, default_tax_rate)
  VALUES (T, 'إلغاء', 'cancel@example.invalid', '0500000001', 'active', true, '300000000000003', true, 15);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (B, T, 'main', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test) VALUES
    (s_own, T, own, 'owner', 'cn-own@example.invalid', 'owner', B, 'active', true),
    (s_cash, T, cash, 'cashier', 'cn-cash@example.invalid', 'cashier', B, 'active', true);
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time) VALUES
    (sh_own, T, B, s_own, 'owner', 0, 'open', now()),
    (sh_cash, T, B, s_cash, 'cashier', 0, 'open', now());
  INSERT INTO public.customers (id, tenant_id, name, phone, is_test) VALUES (c, T, 'c', '0500000002', true);
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- A tailoring order with a 50 deposit, one with nothing paid, and an invoiced POS sale not yet delivered.
  v := public.create_tailoring_order(gen_random_uuid(),
    jsonb_build_object('customer_id', c, 'paid_amount', 50, 'payment_method', 'cash', 'status', 'measurements_taken', 'status_key', 'measurements_taken'),
    '[{"garment_type":"ثوب","quantity":1,"price":100}]'::jsonb);
  o_paid := (v->'order'->>'id')::uuid;
  v := public.create_tailoring_order(gen_random_uuid(),
    jsonb_build_object('customer_id', c, 'paid_amount', 0, 'status', 'measurements_taken', 'status_key', 'measurements_taken'),
    '[{"garment_type":"ثوب","quantity":1,"price":100}]'::jsonb);
  o_free := (v->'order'->>'id')::uuid;
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh_own, 'customer_name', 'W', 'status', 'ready', 'payment_method', 'cash', 'paid_amount', 115, 'delivery_date', now()::text),
    '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
  o_pos := (v->>'order_id')::uuid;
  IF (SELECT paid_amount FROM public.orders WHERE id = o_paid) <> 50 THEN RAISE EXCEPTION 'SETUP the deposit was not taken'; END IF;

  -- 1. A paid order is not cancelled with one tap.
  BEGIN
    PERFORM public.update_order_status(o_paid, 'cancelled', 'cancelled', NULL, gen_random_uuid(), NULL);
    RAISE EXCEPTION 'FAIL a paid order was cancelled without a refund';
  EXCEPTION WHEN SQLSTATE '22023' THEN GET STACKED DIAGNOSTICS hint = PG_EXCEPTION_HINT;
    IF hint <> 'cancel_with_refund' THEN RAISE EXCEPTION 'FAIL wrong refusal %', hint; END IF;
  END;
  checks := checks + 1;
  -- 2. A reason is required.
  BEGIN
    PERFORM public.cancel_order(gen_random_uuid(), o_paid, ' ');
    RAISE EXCEPTION 'FAIL cancelled without a reason';
  EXCEPTION WHEN SQLSTATE '22023' THEN checks := checks + 1;
  END;
  RESET ROLE;

  -- 3. The cashier (no refund permission by default) cannot give the money back.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cash, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.cancel_order(gen_random_uuid(), o_paid, 'العميل عدل');
    RAISE EXCEPTION 'FAIL the cashier refunded';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;
  -- ...but cancels an order with nothing paid.
  v := public.cancel_order(gen_random_uuid(), o_free, 'طلب مكرر');
  IF (SELECT status::text FROM public.orders WHERE id = o_free) <> 'cancelled' OR (v->>'refunded')::numeric <> 0 THEN
    RAISE EXCEPTION 'FAIL unpaid cancel: %', v;
  END IF;
  checks := checks + 1;
  RESET ROLE;

  -- 4. The owner cancels the paid order: the 50 leaves her shift's drawer, the reason is in the history.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v := public.cancel_order(gen_random_uuid(), o_paid, 'العميل عدل عن الطلب');
  RESET ROLE;
  IF (SELECT status::text FROM public.orders WHERE id = o_paid) <> 'cancelled'
     OR NOT EXISTS (SELECT 1 FROM public.shift_entries WHERE shift_id = sh_own AND entry_type = 'payout' AND amount = 50)
     OR NOT EXISTS (SELECT 1 FROM public.order_history WHERE order_id = o_paid AND notes LIKE '%العميل عدل عن الطلب%') THEN
    RAISE EXCEPTION 'FAIL paid cancel: %', v;
  END IF;
  checks := checks + 1;

  -- 5. An invoiced sale is reversed by a credit note on the shift.
  SET LOCAL ROLE authenticated;
  v := public.cancel_order(gen_random_uuid(), o_pos, 'خطأ في البيع');
  RESET ROLE;
  IF NOT (v->>'credit_note')::boolean
     OR NOT EXISTS (SELECT 1 FROM public.sales_returns WHERE order_id = o_pos AND refunded_amount = 115 AND shift_id = sh_own AND refund_method = 'cash') THEN
    RAISE EXCEPTION 'FAIL invoiced cancel: %', v;
  END IF;
  checks := checks + 1;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
