-- Security audit 2026-11-22, batch 1 (20270112000000). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/audit_batch1_identity_test.sql
-- Replays each finding with made-up shops and people (nothing is kept), and
-- reports every check, passed or not, in one line.
DO $test$
DECLARE
  ta uuid := gen_random_uuid();   -- shop A
  tb uuid := gen_random_uuid();   -- shop B
  owner_a text := gen_random_uuid()::text;
  cashier text := gen_random_uuid()::text;   -- cashier in A, owner of B
  admin_a text := gen_random_uuid()::text;
  victim text := gen_random_uuid()::text;    -- owns shop C
  tc uuid := gen_random_uuid();
  nobody text := gen_random_uuid()::text;
  role_b uuid := gen_random_uuid();
  s_admin uuid := gen_random_uuid();
  s_cashier uuid := gen_random_uuid();
  s_owner_a uuid := gen_random_uuid();
  r text;
  n int;
  ok boolean;
  results text[] := '{}';
  failed int := 0;
  claims text;
BEGIN
  -- Setup rows go in as they are (the guards check a signed-in caller there is none of).
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.users (id, email) VALUES (owner_a, 'a@x.test'), (cashier, 'c@x.test'), (admin_a, 'ad@x.test'), (victim, 'v@x.test'), (nobody, 'n@x.test');
  INSERT INTO public.tenants (id, name, owner_email, phone, owner_uid, status, created_at) VALUES
    (ta, 'A', 'a@x.test', '0500000001', owner_a, 'active', now() - interval '10 days'),
    (tb, 'B', 'c@x.test', '0500000002', cashier, 'active', now() - interval '1 day'),
    (tc, 'C', 'v@x.test', '0500000003', victim, 'active', now() - interval '5 days');
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, status, created_at) VALUES
    (s_owner_a, ta, owner_a, 'owner a', 'a@x.test', 'owner', 'active', now() - interval '10 days'),
    (s_cashier, ta, cashier, 'cashier', 'c@x.test', 'cashier', 'active', now() - interval '9 days'),
    (s_admin, ta, admin_a, 'admin', 'ad@x.test', 'admin', 'active', now() - interval '8 days'),
    (gen_random_uuid(), tb, cashier, 'owner b', 'c@x.test', 'owner', 'active', now() - interval '20 days');
  INSERT INTO public.roles (id, tenant_id, role_key, name, permissions) VALUES (role_b, tb, 'owner_like', 'owner-like', '{"settings.edit": true, "staff.create": true}');
  SET LOCAL session_replication_role = origin;

  -- S-03: the cashier of A (who owns B, with an older owner row in B) is a cashier in A.
  claims := json_build_object('sub', cashier, 'role', 'authenticated')::text;
  PERFORM set_config('request.jwt.claims', claims, true);
  SET LOCAL ROLE authenticated;
  -- Their current shop is B (oldest active row); whatever it is, role and staff row agree with it.
  SELECT public.app_current_role() INTO r;
  ok := (SELECT s.tenant_id FROM public.staff s WHERE s.id = public.app_current_staff_id()) = public.app_current_tenant_id();
  RESET ROLE;
  results := results || format('S-03 role/staff row follow the current shop: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  -- S-13: an admin of A cannot give a staff row the custom role of shop B.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.staff SET role_id = role_b WHERE id = s_cashier;
    GET DIAGNOSTICS n = ROW_COUNT;
    ok := n = 0;
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN ok := true;
  END;
  RESET ROLE;
  -- ...and a row that somehow has it gets no permissions from it.
  SET LOCAL session_replication_role = replica;
  UPDATE public.staff SET role_id = role_b WHERE id = s_cashier;
  SET LOCAL session_replication_role = origin;
  ok := ok AND NOT coalesce((public.app_effective_permissions(s_cashier) ->> 'settings.edit')::boolean, false);
  SET LOCAL session_replication_role = replica;
  UPDATE public.staff SET role_id = NULL WHERE id = s_cashier;
  SET LOCAL session_replication_role = origin;
  results := results || format('S-13 another shop''s role is refused and ignored: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  -- S-15: the admin cannot make the cashier an owner, nor demote the owner.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := true;
  BEGIN
    UPDATE public.staff SET role = 'owner' WHERE id = s_cashier;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN ok := false; END IF;
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN NULL;
  END;
  BEGIN
    UPDATE public.staff SET role = 'cashier' WHERE id = s_owner_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN ok := false; END IF;
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN NULL;
  END;
  RESET ROLE;
  results := results || format('S-15 only an owner changes an owner: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  -- S-18: the admin of A cannot plant a staff row with the victim's uid (who owns C).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ok := true;
  BEGIN
    INSERT INTO public.staff (tenant_id, uid, name, email, role, status, created_at)
    VALUES (ta, victim, 'planted', 'v@x.test', 'cashier', 'active', now() - interval '3 years');
    ok := false;
  EXCEPTION WHEN insufficient_privilege OR raise_exception OR check_violation THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', victim, 'role', 'authenticated')::text, true);
  ok := ok AND public.app_current_tenant_id() = tc;
  results := results || format('S-18 no planted row pulls an owner out of their shop: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  -- S-37: someone with no shop gets nothing.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', nobody, 'role', 'authenticated')::text, true);
  SET LOCAL session_replication_role = replica;
  UPDATE public.staff SET pin_hash = 'x' WHERE id = s_owner_a;
  SET LOCAL session_replication_role = origin;
  SET LOCAL ROLE authenticated;
  ok := true;
  BEGIN
    SELECT count(*) INTO n FROM public.staff_ids_with_pin_set(ta);
    IF n > 0 THEN ok := false; END IF;
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN NULL;
  END;
  RESET ROLE;
  results := results || format('S-37 no shop, no staff ids: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  -- S-38: an account cannot write someone else's email into its users row, nor server-only fields.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', nobody, 'role', 'authenticated', 'email', 'n@x.test')::text, true);
  SET LOCAL ROLE authenticated;
  ok := true;
  BEGIN
    UPDATE public.users SET email = 'someone-else@x.test' WHERE id = nobody;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN ok := false; END IF;
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN NULL;
  END;
  UPDATE public.users SET disabled = true, email_verified = true WHERE id = nobody;
  RESET ROLE;
  ok := ok AND NOT (SELECT coalesce(disabled, false) OR coalesce(email_verified, false) FROM public.users WHERE id = nobody);
  results := results || format('S-38 own email only, no server-only fields: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  -- S-39: the owner of a trashed shop cannot edit it.
  SET LOCAL session_replication_role = replica;
  UPDATE public.tenants SET trashed_at = now() WHERE id = tc;
  SET LOCAL session_replication_role = origin;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', victim, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.tenants SET name = 'renamed' WHERE id = tc;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  ok := n = 0;
  results := results || format('S-39 a trashed shop is not editable by its owner: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  -- Still working: the owner of A edits A, adds a cashier, and the admin adds a cashier.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.tenants SET name = 'A2' WHERE id = ta;
  GET DIAGNOSTICS n = ROW_COUNT;
  ok := n = 1 AND public.app_current_role() = 'owner';
  INSERT INTO public.staff (tenant_id, uid, name, email, role, status) VALUES (ta, gen_random_uuid()::text, 'new', 'new@x.test', 'cashier', 'active');
  RESET ROLE;
  results := results || format('regression: the owner still edits the shop and adds staff: %s', CASE WHEN ok THEN 'ok' ELSE 'BROKEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  RAISE EXCEPTION '% -- %', CASE WHEN failed = 0 THEN format('PASS: %s checks', array_length(results, 1)) ELSE format('FAIL: %s of %s', failed, array_length(results, 1)) END,
    array_to_string(results, ' | ');
END
$test$;
