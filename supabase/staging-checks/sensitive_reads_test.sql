-- seen-permissions-fix-task.md Phase 5 (20270101000005_sensitive_reads).
--   npx supabase db query --linked --file supabase/staging-checks/sensitive_reads_test.sql
-- The financial summary, the dashboard amounts and the customers page are
-- also measured cell by cell by supabase/staging-checks/permissions_matrix.sql. Rolled back.
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  B uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  cash text := gen_random_uuid()::text;
  acc text := gen_random_uuid()::text;
  s_own uuid := gen_random_uuid();
  s_cash uuid := gen_random_uuid();
  sh uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  o uuid;
  v jsonb;
  checks int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES (T, 'reads', 'reads@example.invalid', '0500000060', 'active', true);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (B, T, 'main', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test) VALUES
    (s_own, T, own, 'owner', 'r-own@example.invalid', 'owner', B, 'active', true),
    (s_cash, T, cash, 'cashier', 'r-cash@example.invalid', 'cashier', B, 'active', true),
    (gen_random_uuid(), T, acc, 'accountant', 'r-acc@example.invalid', 'accountant', B, 'active', true);
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time) VALUES (sh, T, B, s_cash, 'cashier', 0, 'open', now());
  INSERT INTO public.customers (id, tenant_id, name, phone, is_test) VALUES (c, T, 'c', '0500000061', true);
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v := public.create_tailoring_order(gen_random_uuid(), jsonb_build_object('customer_id', c, 'paid_amount', 0, 'status', 'measurements_taken', 'status_key', 'measurements_taken'),
                                     '[{"garment_type":"ثوب","quantity":1,"price":100}]'::jsonb);
  RESET ROLE;
  o := (v->'order'->>'id')::uuid;

  -- 1. The cashier sees the order count but not the money; the accountant sees the money.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cash, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v := public.get_tenant_financial_summary(T, current_date - 1, current_date);
  IF v->>'revenue' IS NOT NULL OR (v->>'order_count')::int <> 1 THEN RAISE EXCEPTION 'FAIL cashier summary: %', v; END IF;
  v := public.get_dashboard_stats(T);
  IF v->'filtered'->>'paid' IS NOT NULL OR (v->'filtered'->>'orders')::int <> 1 THEN RAISE EXCEPTION 'FAIL cashier dashboard: %', v->'filtered'; END IF;
  RESET ROLE;
  checks := checks + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', acc, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF (public.get_tenant_financial_summary(T, current_date - 1, current_date)->>'revenue')::numeric <> 100 THEN RAISE EXCEPTION 'FAIL accountant summary'; END IF;
  -- 2. The accountant has no customers.view: the customers page is refused.
  BEGIN
    PERFORM public.get_tenant_customers_page(T, 1, 10);
    RAISE EXCEPTION 'FAIL accountant read the customers page';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;
  RESET ROLE;
  checks := checks + 1;

  -- 3. The cashier may take the payment but not deliver in the same step (no orders.update_status).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cash, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.record_order_payment(gen_random_uuid(), o, 100, 'cash', sh, NULL, 'delivered', 'delivered');
    RAISE EXCEPTION 'FAIL the cashier delivered through the payment';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;
  v := public.record_order_payment(gen_random_uuid(), o, 100, 'cash', sh, NULL, NULL, NULL);
  RESET ROLE;
  IF (SELECT paid_amount FROM public.orders WHERE id = o) <> 100 OR (SELECT status::text FROM public.orders WHERE id = o) <> 'measurements_taken' THEN
    RAISE EXCEPTION 'FAIL the plain payment';
  END IF;
  checks := checks + 1;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
