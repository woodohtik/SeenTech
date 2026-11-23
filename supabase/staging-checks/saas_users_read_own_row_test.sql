-- 20270111000000. Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/saas_users_read_own_row_test.sql
DO $test$
DECLARE
  adm record;
  other record;
  ident jsonb;
  n int;
  ok boolean;
  checks int := 0;
BEGIN
  SELECT su.uid, su.role INTO adm FROM public.saas_users su WHERE su.role = 'super_admin' AND su.is_active ORDER BY su.uid LIMIT 1;
  SELECT t.owner_uid AS uid INTO other FROM public.tenants t
   WHERE t.owner_uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.saas_users s WHERE s.uid = t.owner_uid::text) LIMIT 1;
  IF adm.uid IS NULL OR other.uid IS NULL THEN RAISE EXCEPTION 'SKIP: need an admin and a shop owner'; END IF;
  UPDATE public.saas_users SET mfa_enabled = true WHERE uid = adm.uid;

  -- 1. Right after the password (aal1), the admin's identity carries their admin row.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm.uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  SET LOCAL ROLE authenticated;
  ident := public.get_session_identity();
  RESET ROLE;
  IF ident->'saas_user'->>'role' IS DISTINCT FROM 'super_admin' THEN RAISE EXCEPTION 'FAIL aal1 identity has no admin row: %', ident->'saas_user'; END IF;
  checks := checks + 1;

  -- 2. ...but no admin power until the code (SECURITY-06 still holds).
  SET LOCAL ROLE authenticated;
  ok := public.app_is_super_admin();
  RESET ROLE;
  IF ok THEN RAISE EXCEPTION 'FAIL aal1 session counts as super admin'; END IF;
  checks := checks + 1;

  -- 3. In aal1 the admin sees their own row only, not the other admins.
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.saas_users;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL aal1 admin sees % saas_users rows', n; END IF;
  checks := checks + 1;

  -- 4. After the code (aal2), the admin is an admin again and sees the team.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm.uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  SET LOCAL ROLE authenticated;
  ok := public.app_is_super_admin();
  SELECT count(*) INTO n FROM public.saas_users;
  RESET ROLE;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL aal2 admin is not super admin'; END IF;
  IF n < 1 THEN RAISE EXCEPTION 'FAIL aal2 admin sees no rows'; END IF;
  checks := checks + 1;

  -- 5. A shop owner sees no saas_users row at all.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', other.uid::text, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.saas_users;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL a shop owner sees % saas_users rows', n; END IF;
  checks := checks + 1;

  -- 6. Signed out: nothing.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.saas_users;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL anon sees % saas_users rows', n; END IF;
  checks := checks + 1;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
