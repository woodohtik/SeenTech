-- seen-readiness-fixes-task.md P6 (20270109000001). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/admin_audit_revenue_cron_test.sql
DO $test$
DECLARE
  admin_uid text;
  a record;
  b record;
  r jsonb;
  r0 jsonb;
  req uuid;
  n int;
  checks int := 0;
BEGIN
  SELECT su.uid INTO admin_uid FROM public.saas_users su WHERE su.role = 'super_admin' AND coalesce(su.is_active, true) LIMIT 1;
  SELECT t.id, t.owner_uid, t.name INTO a FROM public.tenants t WHERE t.owner_uid IS NOT NULL AND NOT COALESCE(t.is_test, false) ORDER BY t.created_at LIMIT 1;
  SELECT t.id, t.owner_uid, t.name INTO b FROM public.tenants t WHERE t.owner_uid IS NOT NULL AND t.id <> a.id ORDER BY t.created_at LIMIT 1;
  IF admin_uid IS NULL OR a.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'SKIP: need an admin and two shops'; END IF;
  UPDATE public.tenants SET status = 'active', trashed_at = NULL, subscription_status = 'trial', is_trial = true,
         trial_ends_at = now() + interval '5 days', subscription_end_date = NULL, locked_at = NULL, purge_at = NULL, plan_id = 'free' WHERE id = a.id;
  DELETE FROM public.subscription_requests WHERE tenant_id = a.id AND status = 'pending';

  -- 1. A trial past its end is closed without waiting for the sweep; before it, open.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a.owner_uid::text, true);
  IF public.app_current_tenant_id() IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'FAIL a running trial is closed'; END IF;
  UPDATE public.tenants SET trial_ends_at = now() - interval '1 minute' WHERE id = a.id;
  IF public.app_current_tenant_id() IS NOT NULL THEN RAISE EXCEPTION 'FAIL an ended trial is still open'; END IF;
  -- ...but a paid shop with an old trial date is not touched.
  UPDATE public.tenants SET subscription_status = 'active', is_trial = false, subscription_end_date = now() + interval '30 days' WHERE id = a.id;
  IF public.app_current_tenant_id() IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'FAIL a paid shop was closed by its old trial date'; END IF;
  checks := checks + 3;
  UPDATE public.tenants SET subscription_status = 'trial', is_trial = true, trial_ends_at = now() + interval '5 days', subscription_end_date = NULL WHERE id = a.id;

  -- 2. The log helper is not callable from the browser.
  IF has_function_privilege('authenticated', 'public.saas_log_admin_action(text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.saas_log_admin_action(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL the log helper is open';
  END IF;
  checks := checks + 1;

  -- 3. Revenue before: then an approved subscription of 999 raises it by 999 -- a shop's sales do not.
  INSERT INTO public.subscription_requests (tenant_id, plan_id, plan_name, amount, payment_method, status, reference_no)
  VALUES (a.id, 'basic', 'basic', 999, 'bank_transfer', 'pending', 'CHK-REV') RETURNING id INTO req;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  PERFORM set_config('request.jwt.claim.sub', admin_uid, true);
  SET LOCAL ROLE authenticated;
  r0 := public.get_saas_revenue_report();
  PERFORM public.approve_subscription_request(req);
  r := public.get_saas_revenue_report();
  RESET ROLE;
  IF (r->>'total_revenue')::numeric - (r0->>'total_revenue')::numeric <> 999 THEN
    RAISE EXCEPTION 'FAIL revenue % -> %', r0->>'total_revenue', r->>'total_revenue';
  END IF;
  checks := checks + 1;
  -- MRR: one more paying shop at 999 a year = 83.25 a month.
  IF round((r->>'mrr')::numeric - (r0->>'mrr')::numeric, 2) <> 83.25 OR (r->>'paying_shops')::int - (r0->>'paying_shops')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL mrr % -> % (shops % -> %)', r0->>'mrr', r->>'mrr', r0->>'paying_shops', r->>'paying_shops';
  END IF;
  checks := checks + 1;
  IF (SELECT COALESCE(SUM(total_amount), 0) FROM public.orders) > 0 AND (r->>'total_revenue')::numeric = (SELECT COALESCE(SUM(total_amount), 0) FROM public.orders) THEN
    RAISE EXCEPTION 'FAIL revenue is still the shops'' sales';
  END IF;
  checks := checks + 1;

  -- 4. Approve, reject, trash, restore and delete each leave a log line, written by the server.
  INSERT INTO public.subscription_requests (tenant_id, plan_id, plan_name, amount, payment_method, status, reference_no)
  VALUES (b.id, 'basic', 'basic', 999, 'bank_transfer', 'pending', 'CHK-REJ') RETURNING id INTO req;
  SET LOCAL ROLE authenticated;
  PERFORM public.reject_subscription_request(req, 'no proof');
  PERFORM public.trash_tenant(b.id, b.name);
  PERFORM public.restore_tenant(b.id);
  PERFORM public.trash_tenant(b.id, b.name);
  PERFORM public.export_tenant_data(b.id);
  PERFORM public.permanently_delete_tenant(b.id, b.name);
  RESET ROLE;
  SELECT count(DISTINCT action) INTO n FROM public.saas_security_logs
   WHERE occurred_at > now() - interval '1 minute'
     AND action IN ('approve_subscription_request', 'reject_subscription_request', 'trash_tenant', 'restore_tenant', 'permanently_delete_tenant');
  IF n <> 5 THEN RAISE EXCEPTION 'FAIL % of 5 actions logged', n; END IF;
  checks := checks + 1;
  -- The line about the deleted shop outlives it.
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = b.id)
     OR NOT EXISTS (SELECT 1 FROM public.saas_security_logs WHERE action = 'permanently_delete_tenant' AND details LIKE '%' || b.id::text || '%') THEN
    RAISE EXCEPTION 'FAIL the delete log did not survive';
  END IF;
  checks := checks + 1;

  -- 5. The scheduled jobs can be read, with how each last ran; not by a shop.
  SET LOCAL ROLE authenticated;
  r := public.saas_cron_health();
  RESET ROLE;
  IF (r->>'pg_cron')::boolean IS NOT TRUE OR jsonb_array_length(r->'jobs') < 1 OR NOT (r->'jobs'->0 ? 'last_status') THEN
    RAISE EXCEPTION 'FAIL cron health: %', left(r::text, 300);
  END IF;
  checks := checks + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a.owner_uid::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.saas_cron_health();
    RESET ROLE; RAISE EXCEPTION 'FAIL a shop read the cron jobs';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; checks := checks + 1;
  END;
  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
