-- seen-readiness-fixes-task.md P6 (20270107000002). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/support_access_consent_test.sql
DO $test$
DECLARE
  admin_uid text;
  a record;
  b record;
  req uuid;
  r jsonb;
  n int;
  checks int := 0;
BEGIN
  SELECT su.uid INTO admin_uid FROM public.saas_users su WHERE su.role = 'super_admin' AND coalesce(su.is_active, true) LIMIT 1;
  SELECT t.id, t.owner_uid INTO a FROM public.tenants t WHERE t.owner_uid IS NOT NULL ORDER BY t.created_at LIMIT 1;
  -- An owner with no tie at all to shop A (not its owner, not on its staff).
  SELECT t.id, t.owner_uid INTO b FROM public.tenants t
   WHERE t.owner_uid IS NOT NULL AND t.id <> a.id AND t.owner_uid <> a.owner_uid
     AND NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.uid = t.owner_uid AND s.tenant_id = a.id)
   ORDER BY t.created_at LIMIT 1;
  IF admin_uid IS NULL OR a.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'SKIP: need an admin and two shops'; END IF;
  INSERT INTO public.support_access_requests (tenant_id, saas_user_id, saas_user_name, status, requested_at, expires_at)
  VALUES (a.id, admin_uid::uuid, 'support', 'pending', now(), now() + interval '15 minutes') RETURNING id INTO req;

  -- 1. The shop's owner sees the request; another shop's owner does not, nor can answer it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', b.owner_uid::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.support_access_requests WHERE id = req;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL another shop sees the request'; END IF;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.respond_support_access_request(req, true);
    RESET ROLE; RAISE EXCEPTION 'FAIL another shop answered';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE;
  END;
  checks := checks + 2;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a.owner_uid::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.support_access_requests WHERE id = req;
  IF n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'FAIL the owner does not see the request'; END IF;
  -- 2. The owner approves it, once.
  IF public.respond_support_access_request(req, true) <> 'approved' THEN RESET ROLE; RAISE EXCEPTION 'FAIL approve'; END IF;
  RESET ROLE;
  checks := checks + 2;
  IF (SELECT responded_by FROM public.support_access_requests WHERE id = req) <> a.owner_uid::text THEN RAISE EXCEPTION 'FAIL who answered not recorded'; END IF;
  checks := checks + 1;

  -- 3. The admin's session on that approval is explicit; without one it is stealth.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  PERFORM set_config('request.jwt.claim.sub', admin_uid, true);
  SET LOCAL ROLE authenticated;
  r := public.start_support_session(a.id, req);
  IF r->>'access_type' <> 'explicit' THEN RESET ROLE; RAISE EXCEPTION 'FAIL explicit: %', r; END IF;
  r := public.start_support_session(a.id);
  IF r->>'access_type' <> 'stealth' THEN RESET ROLE; RAISE EXCEPTION 'FAIL stealth: %', r; END IF;
  RESET ROLE;
  checks := checks + 2;
  -- 4. Another shop's approval does not make a session here explicit.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.start_support_session(b.id, req);
    RESET ROLE; RAISE EXCEPTION 'FAIL used another shop''s approval';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; checks := checks + 1;
  END;
  -- 5. Nobody writes a session row directly any more.
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.support_sessions (tenant_id, saas_user_id, saas_user_name, access_type, started_at)
    VALUES (a.id, admin_uid::uuid, 'x', 'explicit', now());
    RESET ROLE; RAISE EXCEPTION 'FAIL a session row was written directly';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; checks := checks + 1;
  END;

  -- 6. The owner sees both sessions in the shop, the stealth one included.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a.owner_uid::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.support_sessions WHERE tenant_id = a.id AND started_at > now() - interval '1 minute';
  RESET ROLE;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL the owner sees % sessions', n; END IF;
  checks := checks + 1;
  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
