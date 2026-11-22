-- seen-readiness-fixes-task.md P4 (20270105000005). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/measurement_links_test.sql
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  B1 uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  c uuid := gen_random_uuid();
  old_token uuid;
  link jsonb;
  checks int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES (T, 'مقاسات', 'ml@example.invalid', '0500000018', 'active', true);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (B1, T, 'أ', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test)
  VALUES (gen_random_uuid(), T, own, 'owner', 'ml-own@example.invalid', 'owner', B1, 'active', true);
  INSERT INTO public.customers (id, tenant_id, name, phone, is_test, measurements) VALUES (c, T, 'أحمد', '0500000019', true, '{"chest": 50}');
  SET LOCAL session_replication_role = origin;
  SELECT measurements_token INTO old_token FROM public.customers WHERE id = c;

  -- 1. A new customer's link lasts about 7 days.
  IF (SELECT measurements_token_expires_at FROM public.customers WHERE id = c) NOT BETWEEN now() + interval '6 days' AND now() + interval '8 days' THEN
    RAISE EXCEPTION 'FAIL no 7-day expiry';
  END IF;
  checks := checks + 1;

  -- 2. Sending a new link ends the old one.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  link := public.issue_measurements_link(c);
  RESET ROLE;
  SET LOCAL ROLE service_role;
  IF public.save_public_measurements(old_token, '{"chest": 99}') IS NOT NULL THEN RAISE EXCEPTION 'FAIL the old link still saves'; END IF;
  checks := checks + 1;

  -- 3. The new link saves, keeps the previous measurements and tells the shop.
  IF public.save_public_measurements((link->>'token')::uuid, '{"chest": 52}') IS NULL THEN RAISE EXCEPTION 'FAIL the new link did not save'; END IF;
  RESET ROLE;
  IF (SELECT measurements->>'chest' FROM public.customers WHERE id = c) <> '52'
     OR (SELECT previous->>'chest' FROM public.customer_measurement_changes WHERE customer_id = c) <> '50'
     OR NOT EXISTS (SELECT 1 FROM public.notifications WHERE tenant_id = T AND metadata->>'kind' = 'measurements_from_link') THEN
    RAISE EXCEPTION 'FAIL save, history or notice';
  END IF;
  checks := checks + 2;

  -- 4. An expired or revoked link does not save; a visitor cannot issue one.
  SET LOCAL ROLE authenticated;
  PERFORM public.revoke_measurements_link(c);
  RESET ROLE;
  SET LOCAL ROLE service_role;
  IF public.save_public_measurements((link->>'token')::uuid, '{"chest": 1}') IS NOT NULL THEN RAISE EXCEPTION 'FAIL a revoked link saved'; END IF;
  RESET ROLE;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.issue_measurements_link(c);
    RAISE EXCEPTION 'FAIL a visitor issued a link';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 2;
  END;
  RESET ROLE;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
