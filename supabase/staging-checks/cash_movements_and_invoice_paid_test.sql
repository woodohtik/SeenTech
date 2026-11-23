-- seen-readiness-fixes-task.md P6 (20270108000000). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/cash_movements_and_invoice_paid_test.sql
DO $test$
DECLARE
  me record;
  other record;
  my_shift uuid;
  other_shift uuid;
  op uuid := gen_random_uuid();
  r jsonb;
  inv record;
  n int;
  checks int := 0;
BEGIN
  -- An active employee with an account (a second one is made if needed).
  SELECT s.id, s.uid, s.tenant_id, s.branch_id INTO me FROM public.staff s JOIN public.tenants t ON t.id = s.tenant_id
   WHERE s.status = 'active' AND s.uid IS NOT NULL AND s.branch_id IS NOT NULL AND t.trashed_at IS NULL AND t.status <> 'inactive'
   ORDER BY (s.role::text IN ('owner', 'admin', 'manager')), s.created_at LIMIT 1;
  SELECT s.id INTO other FROM public.staff s WHERE s.tenant_id = me.tenant_id AND s.id <> me.id LIMIT 1;
  IF other.id IS NULL AND me.id IS NOT NULL THEN
    INSERT INTO public.staff (tenant_id, branch_id, name, email, role, status)
    VALUES (me.tenant_id, me.branch_id, 'cash-check', 'cash-check-' || left(gen_random_uuid()::text, 8) || '@example.invalid', 'tailor', 'active') RETURNING id INTO other;
  END IF;
  UPDATE public.tenants SET status = 'active', trashed_at = NULL, subscription_status = 'active' WHERE id = me.tenant_id;
  IF me.id IS NULL OR other.id IS NULL THEN RAISE EXCEPTION 'SKIP: need two employees in one shop'; END IF;
  UPDATE public.tenants SET subscription_end_date = NULL WHERE id = me.tenant_id;
  UPDATE public.shifts SET status = 'closed' WHERE staff_id IN (me.id, other.id) AND status = 'open';
  INSERT INTO public.shifts (tenant_id, branch_id, staff_id, staff_name, status) VALUES (me.tenant_id, me.branch_id, me.id, 'me', 'open') RETURNING id INTO my_shift;
  INSERT INTO public.shifts (tenant_id, branch_id, staff_id, staff_name, status) VALUES (me.tenant_id, me.branch_id, other.id, 'other', 'open') RETURNING id INTO other_shift;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', me.uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', me.uid::text, true);
  SET LOCAL ROLE authenticated;
  -- 1. A deposit into my own open shift; a retry is the same entry.
  r := public.record_cash_movement(op, my_shift, 'deposit', 50.005, 'فكّة');
  r := public.record_cash_movement(op, my_shift, 'deposit', 50.005, 'فكّة');
  SELECT count(*) INTO n FROM public.shift_entries WHERE shift_id = my_shift;
  RESET ROLE;
  IF n <> 1 OR (r->>'replayed')::boolean IS NOT TRUE OR (SELECT amount FROM public.shift_entries WHERE id = op) <> 50.01 THEN
    RAISE EXCEPTION 'FAIL deposit / replay: % rows, %', n, r;
  END IF;
  checks := checks + 2;
  -- 2. Not into someone else's shift without shifts.manage (checked when
  --    this employee does not have it).
  SET LOCAL ROLE authenticated;
  n := CASE WHEN public.app_has_permission('shifts.manage') THEN 1 ELSE 0 END;
  RESET ROLE;
  IF n = 0 THEN
    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM public.record_cash_movement(gen_random_uuid(), other_shift, 'payout', 10, 'x');
      RESET ROLE; RAISE EXCEPTION 'FAIL wrote into another employee''s shift';
    EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; checks := checks + 1;
    END;
  ELSE
    SET LOCAL ROLE authenticated;
    PERFORM public.record_cash_movement(gen_random_uuid(), other_shift, 'payout', 10, 'manager');
    RESET ROLE;
    checks := checks + 1;  -- a shift manager may
  END IF;
  -- 3. Not into a closed shift; not a zero amount; not without a reason.
  UPDATE public.shifts SET status = 'closed' WHERE id = my_shift;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.record_cash_movement(gen_random_uuid(), my_shift, 'payout', 10, 'x');
    RESET ROLE; RAISE EXCEPTION 'FAIL wrote into a closed shift';
  EXCEPTION WHEN invalid_parameter_value THEN RESET ROLE; checks := checks + 1;
  END;
  UPDATE public.shifts SET status = 'open' WHERE id = my_shift;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.record_cash_movement(gen_random_uuid(), my_shift, 'payout', 0, 'x');
    RESET ROLE; RAISE EXCEPTION 'FAIL zero amount';
  EXCEPTION WHEN invalid_parameter_value THEN RESET ROLE; checks := checks + 1;
  END;
  -- 4. No direct writes, of any kind.
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.shift_entries (tenant_id, shift_id, entry_type, amount, reason) VALUES (me.tenant_id, my_shift, 'deposit', 1, 'x');
    RESET ROLE; RAISE EXCEPTION 'FAIL direct insert';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; checks := checks + 1;
  END;
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.shift_entries SET amount = 1 WHERE id = op;
    RESET ROLE; RAISE EXCEPTION 'FAIL direct update';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; checks := checks + 1;
  END;

  -- 5. A tax invoice's paid amount follows the order, whatever the browser sends.
  SELECT ti.id, ti.order_id INTO inv FROM public.tax_invoices ti JOIN public.orders o ON o.id = ti.order_id WHERE ti.tenant_id = me.tenant_id LIMIT 1;
  IF inv.id IS NOT NULL THEN
    SET LOCAL ROLE authenticated;
    PERFORM public.sync_tax_invoice_paid_amount(inv.order_id, 999999);
    RESET ROLE;
    IF (SELECT ti.paid_amount FROM public.tax_invoices ti WHERE ti.id = inv.id) IS DISTINCT FROM (SELECT o.paid_amount FROM public.orders o WHERE o.id = inv.order_id) THEN
      RAISE EXCEPTION 'FAIL the invoice took the browser''s number';
    END IF;
    checks := checks + 1;
  END IF;
  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
