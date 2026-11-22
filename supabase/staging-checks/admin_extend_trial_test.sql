-- seen-readiness-fixes-task.md P5 (20270106000002). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/admin_extend_trial_test.sql
DO $test$
DECLARE
  admin_uid text;
  s record;
  created0 timestamptz;
  checks int := 0;
BEGIN
  SELECT su.uid INTO admin_uid FROM public.saas_users su WHERE su.role = 'super_admin' AND coalesce(su.is_active, true) LIMIT 1;
  SELECT t.id, t.owner_uid INTO s FROM public.tenants t WHERE t.owner_uid IS NOT NULL ORDER BY t.created_at LIMIT 1;
  IF admin_uid IS NULL OR s.id IS NULL THEN RAISE EXCEPTION 'SKIP: need an admin and a shop'; END IF;
  -- A locked, expired trial.
  UPDATE public.tenants SET subscription_status = 'locked', is_trial = true, trial_ends_at = now() - interval '3 days',
         locked_at = now() - interval '3 days', purge_at = now() + interval '27 days' WHERE id = s.id;
  SELECT created_at INTO created0 FROM public.tenants WHERE id = s.id;

  -- 1. The owner cannot extend it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', s.owner_uid::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.admin_extend_trial(s.id, 14);
    RESET ROLE; RAISE EXCEPTION 'FAIL an owner extended the trial';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; checks := checks + 1;
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  PERFORM set_config('request.jwt.claim.sub', admin_uid, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.admin_extend_trial(s.id, 14);
  RESET ROLE;
  -- 2. From today (the trial had already ended), a trial again, unlocked.
  IF (SELECT abs(extract(epoch FROM trial_ends_at - (now() + interval '14 days'))) FROM public.tenants WHERE id = s.id) > 60
     OR (SELECT subscription_status FROM public.tenants WHERE id = s.id) <> 'trial'
     OR (SELECT locked_at IS NOT NULL OR purge_at IS NOT NULL FROM public.tenants WHERE id = s.id) THEN
    RAISE EXCEPTION 'FAIL not extended: %', (SELECT row_to_json(x) FROM (SELECT trial_ends_at, subscription_status, locked_at, purge_at FROM public.tenants WHERE id = s.id) x);
  END IF;
  checks := checks + 1;
  -- 3. The lock sweep leaves it alone now.
  PERFORM public.trial_lock_sweep();
  IF (SELECT subscription_status FROM public.tenants WHERE id = s.id) <> 'trial' THEN RAISE EXCEPTION 'FAIL relocked'; END IF;
  checks := checks + 1;
  -- 4. The creation date did not move, and cannot be moved.
  UPDATE public.tenants SET created_at = now() WHERE id = s.id;
  IF (SELECT created_at FROM public.tenants WHERE id = s.id) <> created0 THEN RAISE EXCEPTION 'FAIL created_at changed'; END IF;
  checks := checks + 1;
  -- 5. Logged.
  IF NOT EXISTS (SELECT 1 FROM public.saas_security_logs WHERE action = 'extend_trial' AND details LIKE '%' || s.id::text || '%') THEN RAISE EXCEPTION 'FAIL no log'; END IF;
  checks := checks + 1;
  -- 6. A shop on a paid plan has no trial to extend.
  UPDATE public.tenants SET subscription_status = 'active', is_trial = false WHERE id = s.id;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.admin_extend_trial(s.id, 14);
    RESET ROLE; RAISE EXCEPTION 'FAIL extended a paid shop';
  EXCEPTION WHEN invalid_parameter_value THEN RESET ROLE; checks := checks + 1;
  END;
  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
