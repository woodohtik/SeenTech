-- seen-readiness-fixes-task.md P6 (20270109000000). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/plans_coupons_referrals_test.sql
DO $test$
DECLARE
  admin_uid text;
  a record;
  b record;
  r jsonb;
  req uuid;
  col_names text;
  col_values text;
  src uuid;
  w0 numeric;
  n int;
  checks int := 0;
BEGIN
  SELECT su.uid INTO admin_uid FROM public.saas_users su WHERE su.role = 'super_admin' AND coalesce(su.is_active, true) LIMIT 1;
  SELECT t.id, t.owner_uid, t.name INTO a FROM public.tenants t WHERE t.owner_uid IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.orders o WHERE o.tenant_id = t.id AND o.status::text <> 'cancelled') ORDER BY t.created_at LIMIT 1;
  SELECT t.id, t.owner_uid INTO b FROM public.tenants t WHERE t.owner_uid IS NOT NULL AND t.id <> a.id ORDER BY t.created_at LIMIT 1;
  IF admin_uid IS NULL OR a.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'SKIP: need an admin and two shops'; END IF;
  UPDATE public.tenants SET status = 'active', trashed_at = NULL, subscription_status = 'trial', is_trial = true,
         trial_ends_at = now() + interval '5 days', subscription_end_date = NULL, locked_at = NULL, purge_at = NULL WHERE id = a.id;
  DELETE FROM public.subscription_requests WHERE tenant_id = a.id AND status = 'pending';

  -- 1. Both base plans exist.
  IF (SELECT count(*) FROM public.plans WHERE id IN ('free', 'basic')) <> 2 THEN RAISE EXCEPTION 'FAIL base plans'; END IF;
  checks := checks + 1;

  -- 2. A plan with a limit of 0 does not block an order (it blocked every one).
  INSERT INTO public.plans (id, name, price, features, max_staff, max_orders, is_active, billing_period)
  VALUES ('zz_nolimit', 'x', 0, '[]', 1, 0, true, 'year'), ('zz_one', 'x', 0, '[]', 1, 1, true, 'year'), ('zz_monthly', 'monthly', 50, '[]', 1, 0, true, 'month');
  SELECT id INTO src FROM public.orders WHERE tenant_id = a.id AND status::text <> 'cancelled' LIMIT 1;
  IF src IS NULL THEN RAISE EXCEPTION 'SKIP: need a live order to copy'; END IF;
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
         string_agg(CASE column_name
             WHEN 'id' THEN 'gen_random_uuid()'
             WHEN 'order_number' THEN '(SELECT max(order_number) FROM public.orders) + 9001'
             WHEN 'tracking_token' THEN 'gen_random_uuid()'
             WHEN 'order_date' THEN 'now()'
             WHEN 'credited_amount' THEN '0'
             ELSE quote_ident(column_name) END, ', ' ORDER BY ordinal_position)
    INTO col_names, col_values
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND is_generated = 'NEVER';
  UPDATE public.tenants SET plan_id = 'zz_nolimit' WHERE id = a.id;
  EXECUTE format('INSERT INTO public.orders (%s) SELECT %s FROM public.orders WHERE id = $1', col_names, col_values) USING src;
  checks := checks + 1;
  -- ...and a real limit still does.
  UPDATE public.tenants SET plan_id = 'zz_one' WHERE id = a.id;
  BEGIN
    EXECUTE format('INSERT INTO public.orders (%s) SELECT %s FROM public.orders WHERE id = $1', col_names, replace(col_values, '+ 9001', '+ 9002')) USING src;
    RAISE EXCEPTION 'FAIL a limit of 1 did not block';
  EXCEPTION WHEN check_violation THEN checks := checks + 1;
  END;
  UPDATE public.tenants SET plan_id = 'free' WHERE id = a.id;

  -- 3. One request under review at a time; a coupon once per shop.
  INSERT INTO public.coupons (code, discount_type, discount_value, is_active) VALUES ('ZZCHK10', 'percentage', 10, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a.owner_uid::text, true);
  SET LOCAL ROLE authenticated;
  SELECT x.id INTO req FROM public.create_subscription_request(a.id, 'basic', 'bank_transfer', NULL, 'CHK-1', NULL, 'zzchk10') x;
  RESET ROLE;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.create_subscription_request(a.id, 'basic', 'bank_transfer');
    RESET ROLE; RAISE EXCEPTION 'FAIL a second pending request was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN RESET ROLE; checks := checks + 1;
  END;
  UPDATE public.subscription_requests SET status = 'approved' WHERE id = req;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.create_subscription_request(a.id, 'basic', 'bank_transfer', NULL, 'CHK-2', NULL, 'ZZCHK10');
    RESET ROLE; RAISE EXCEPTION 'FAIL the coupon was used twice by one shop';
  EXCEPTION WHEN invalid_parameter_value THEN RESET ROLE; checks := checks + 1;
  END;

  -- 4. The manual activation: the super admin only, with a reason.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.admin_activate_plan(a.id, 'basic', 0, 'x');
    RESET ROLE; RAISE EXCEPTION 'FAIL an owner activated a plan';
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; checks := checks + 1;
  END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  PERFORM set_config('request.jwt.claim.sub', admin_uid, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.admin_activate_plan(a.id, 'basic', 0, '  ');
    RESET ROLE; RAISE EXCEPTION 'FAIL activated without a reason';
  EXCEPTION WHEN invalid_parameter_value THEN RESET ROLE; checks := checks + 1;
  END;

  -- 5. A referral: a free manual activation credits nothing...
  INSERT INTO public.referrals (referrer_tenant_id, referred_tenant_id, reward_amount, status, qualified_until)
  VALUES (b.id, a.id, 150, 'pending', now() + interval '30 days');
  SELECT COALESCE((SELECT balance FROM public.referral_wallets WHERE tenant_id = b.id), 0) INTO w0;
  SET LOCAL ROLE authenticated;
  r := public.admin_activate_plan(a.id, 'zz_monthly', 0, 'a gift');
  RESET ROLE;
  IF (SELECT subscription_status FROM public.tenants WHERE id = a.id) <> 'active'
     OR abs(extract(epoch FROM (SELECT subscription_end_date FROM public.tenants WHERE id = a.id) - (now() + interval '1 month'))) > 60 THEN
    RAISE EXCEPTION 'FAIL manual activation state: %', r;
  END IF;
  IF COALESCE((SELECT balance FROM public.referral_wallets WHERE tenant_id = b.id), 0) <> w0
     OR (SELECT status FROM public.referrals WHERE referred_tenant_id = a.id) <> 'pending' THEN
    RAISE EXCEPTION 'FAIL a free activation credited the referrer';
  END IF;
  SELECT count(*) INTO n FROM public.saas_subscription_payments WHERE tenant_id = a.id AND reference LIKE 'MANUAL-%';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL a payment row for a free activation'; END IF;
  checks := checks + 2;
  -- 6. ...and a paid one credits it, once, with the payment in the ledger and a log line.
  SET LOCAL ROLE authenticated;
  r := public.admin_activate_plan(a.id, 'zz_monthly', 50, 'paid in cash', 'cash');
  RESET ROLE;
  IF COALESCE((SELECT balance FROM public.referral_wallets WHERE tenant_id = b.id), 0) <> w0 + 150
     OR (SELECT status FROM public.referrals WHERE referred_tenant_id = a.id) <> 'credited' THEN
    RAISE EXCEPTION 'FAIL the paid activation did not credit: wallet %', (SELECT balance FROM public.referral_wallets WHERE tenant_id = b.id);
  END IF;
  IF (SELECT count(*) FROM public.saas_subscription_payments WHERE tenant_id = a.id AND reference LIKE 'MANUAL-%' AND amount = 50) <> 1 THEN RAISE EXCEPTION 'FAIL ledger'; END IF;
  IF (SELECT count(*) FROM public.saas_security_logs WHERE action = 'activate_plan' AND details LIKE '%' || a.id::text || '%') <> 2 THEN RAISE EXCEPTION 'FAIL log'; END IF;
  checks := checks + 3;
  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
