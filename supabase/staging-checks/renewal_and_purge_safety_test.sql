-- seen-readiness-fixes-task.md P5 (20270106000003). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/renewal_and_purge_safety_test.sql
DO $test$
DECLARE
  s record;
  o record;
  stranger text := gen_random_uuid()::text;
  req uuid;
  bare uuid;
  n int;
  checks int := 0;
BEGIN
  SELECT t.id, t.owner_uid INTO s FROM public.tenants t WHERE t.owner_uid IS NOT NULL ORDER BY t.created_at LIMIT 1;
  SELECT t.id, t.owner_uid INTO o FROM public.tenants t WHERE t.owner_uid IS NOT NULL AND t.id <> s.id ORDER BY t.created_at LIMIT 1;
  IF s.id IS NULL OR o.id IS NULL THEN RAISE EXCEPTION 'SKIP: need two shops'; END IF;

  -- 1. A paid shop two days past its end is still in grace: not locked, and
  --    its owner still resolves to it.
  UPDATE public.tenants SET subscription_status = 'active', is_trial = false, status = 'active', trashed_at = NULL,
         subscription_end_date = now() - interval '2 days', locked_at = NULL, purge_at = NULL WHERE id = s.id;
  PERFORM public.trial_lock_sweep();
  IF (SELECT subscription_status FROM public.tenants WHERE id = s.id) <> 'active' THEN RAISE EXCEPTION 'FAIL locked during grace'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', s.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', s.owner_uid::text, true);
  IF public.app_current_tenant_id() IS DISTINCT FROM s.id THEN RAISE EXCEPTION 'FAIL no access during grace'; END IF;
  checks := checks + 1;

  -- 2. Four days past: locked.
  UPDATE public.tenants SET subscription_end_date = now() - interval '4 days' WHERE id = s.id;
  PERFORM public.trial_lock_sweep();
  IF (SELECT subscription_status FROM public.tenants WHERE id = s.id) <> 'locked' OR public.app_current_tenant_id() IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL not locked after the grace';
  END IF;
  checks := checks + 1;

  -- 3. The owner of the locked shop can send a renewal request and see it.
  SET LOCAL ROLE authenticated;
  SELECT r.id INTO req FROM public.create_subscription_request(s.id, 'basic', 'bank_transfer', NULL, 'CHK-RENEW') r;
  SELECT count(*) INTO n FROM public.subscription_requests WHERE id = req;
  RESET ROLE;
  IF req IS NULL OR n <> 1 THEN RAISE EXCEPTION 'FAIL the locked owner could not renew (req %, seen %)', req, n; END IF;
  checks := checks + 1;

  -- 4. Someone else cannot send one for that shop, nor see it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', o.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', o.owner_uid::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.create_subscription_request(s.id, 'basic', 'bank_transfer');
    RESET ROLE; RAISE EXCEPTION 'FAIL another shop''s owner sent a request';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; checks := checks + 1;
  END;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.subscription_requests WHERE id = req;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL another shop sees the request'; END IF;
  checks := checks + 1;

  -- 5. A locked trial past its purge date is not purged while the request is pending...
  UPDATE public.tenants SET is_trial = true, purge_at = now() - interval '1 day' WHERE id = s.id;
  PERFORM public.trial_purge_sweep();
  IF (SELECT subscription_status FROM public.tenants WHERE id = s.id) <> 'locked' THEN RAISE EXCEPTION 'FAIL purged with a pending proof'; END IF;
  checks := checks + 1;
  -- 6. Rejected now -- but a shop with financial records is still kept.
  UPDATE public.subscription_requests SET status = 'rejected' WHERE id = req;
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE tenant_id = s.id) THEN
    INSERT INTO public.shifts (tenant_id, branch_id, staff_id, status)
    SELECT s.id, st.branch_id, st.id, 'closed' FROM public.staff st WHERE st.tenant_id = s.id LIMIT 1;
  END IF;
  PERFORM public.trial_purge_sweep();
  IF (SELECT subscription_status FROM public.tenants WHERE id = s.id) <> 'locked' THEN RAISE EXCEPTION 'FAIL a shop with records was purged'; END IF;
  checks := checks + 1;
  -- 7. A bare trial shop is purged, in the same sweep that keeps the other.
  INSERT INTO public.tenants (name, plan_id, owner_email, phone) VALUES ('purge-check', 'free', 'purge-check@example.invalid', '+966500000000') RETURNING id INTO bare;
  UPDATE public.tenants SET subscription_status = 'locked', is_trial = true, purge_at = now() - interval '1 day' WHERE id = bare;
  PERFORM public.trial_purge_sweep();
  IF (SELECT subscription_status FROM public.tenants WHERE id = bare) <> 'purge_pending' THEN RAISE EXCEPTION 'FAIL the bare trial was not purged'; END IF;
  checks := checks + 1;
  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
