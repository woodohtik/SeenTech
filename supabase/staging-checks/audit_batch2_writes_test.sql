-- Security audit 2026-11-22, batch 2 (20270112000001). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/audit_batch2_writes_test.sql
DO $test$
DECLARE
  ta uuid := gen_random_uuid();
  owner_a text := gen_random_uuid()::text;
  cashier text := gen_random_uuid()::text;
  tailor text := gen_random_uuid()::text;
  s_cashier uuid := gen_random_uuid();
  shift_id uuid := gen_random_uuid();
  n int;
  ok boolean;
  msg text;
  results text[] := '{}';
  failed int := 0;
  as_who text;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.users (id, email) VALUES (owner_a, 'a@x.test'), (cashier, 'c@x.test'), (tailor, 't@x.test');
  INSERT INTO public.tenants (id, name, owner_email, phone, owner_uid, status) VALUES (ta, 'A', 'a@x.test', '0500000001', owner_a, 'active');
  INSERT INTO public.staff (tenant_id, uid, name, email, role, status) VALUES
    (ta, owner_a, 'owner', 'a@x.test', 'owner', 'active'),
    (ta, tailor, 'tailor', 't@x.test', 'tailor', 'active');
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, status) VALUES (s_cashier, ta, cashier, 'cashier', 'c@x.test', 'cashier', 'active');
  INSERT INTO public.referral_wallets (tenant_id, balance) VALUES (ta, 2000);
  INSERT INTO public.shifts (id, tenant_id, staff_id, staff_name, opening_balance, status) VALUES (shift_id, ta, s_cashier, 'cashier', 0, 'open');
  SET LOCAL session_replication_role = origin;

  -- S-05: a cashier cannot withdraw the referral balance.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cashier, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := true;
  BEGIN
    PERFORM public.request_withdrawal(ta, 1200, 'SA0000000000000000000000', 'x');
    ok := false;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;
  ok := ok AND (SELECT balance FROM public.referral_wallets WHERE tenant_id = ta) = 2000;
  results := results || format('S-05 a cashier cannot withdraw: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  -- S-06: a tailor cannot add a branch; S-10: nor a shift or a cash entry.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tailor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := true;
  BEGIN
    INSERT INTO public.branches (tenant_id, name, location) VALUES (ta, 'tailor branch', 'x');
    ok := false;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  results := results || format('S-06 a tailor cannot add a branch: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;
  ok := true;
  BEGIN
    INSERT INTO public.shift_entries (tenant_id, shift_id, entry_type, amount, reason) VALUES (ta, shift_id, 'deposit', 500, 'x');
    ok := false;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.shifts (tenant_id, staff_id, staff_name, opening_balance, status) VALUES (ta, s_cashier, 'x', 0, 'closed');
    ok := false;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  results := results || format('S-10 a tailor cannot write shifts or cash entries: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  -- S-14: a cashier cannot confirm a purchase order (refused on permission, before looking it up).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cashier, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  msg := '';
  BEGIN
    PERFORM public.confirm_purchase_order(gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM;
  END;
  RESET ROLE;
  ok := position('صلاحية' in msg) > 0;
  results := results || format('S-14 a cashier cannot confirm purchases: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  -- S-17: a tailor's audit entry carries the tailor, whatever it claims.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', tailor, 'role', 'authenticated', 'email', 't@x.test')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.audit_logs (tenant_id, action, performed_by, performed_by_email, details)
    VALUES (ta, 'forged', owner_a, 'owner@x.test', 'x');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;
  SELECT performed_by INTO as_who FROM public.audit_logs WHERE tenant_id = ta AND action = 'forged';
  ok := as_who IS NULL OR as_who = tailor;
  results := results || format('S-17 a log entry carries its real author: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  -- S-40: reopening a cancelled order goes through the plan limit.
  ok := EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'enforce_orders_plan_limit_reopen' AND NOT tgisinternal);
  results := results || format('S-40 the plan limit runs on reopening: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  -- Still working: the owner adds a branch.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := true;
  BEGIN
    INSERT INTO public.branches (tenant_id, name, location) VALUES (ta, 'owner branch', 'x');
  EXCEPTION WHEN OTHERS THEN ok := false; msg := SQLERRM;
  END;
  RESET ROLE;
  results := results || format('regression: the owner still adds a branch: %s', CASE WHEN ok THEN 'ok' ELSE 'BROKEN ' || coalesce(msg, '') END);
  IF NOT ok THEN failed := failed + 1; END IF;

  RAISE EXCEPTION '% -- %', CASE WHEN failed = 0 THEN format('PASS: %s checks', array_length(results, 1)) ELSE format('FAIL: %s of %s', failed, array_length(results, 1)) END,
    array_to_string(results, ' | ');
END
$test$;
