-- seen-readiness-fixes-task.md P5 (20270106000001). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/subscription_billing_test.sql
DO $test$
DECLARE
  admin_uid text;
  a record;
  b record;
  req_m uuid;
  req_y uuid;
  end0 timestamptz := date_trunc('second', now()) + interval '10 days';
  sales_before bigint;
  led record;
  n int;
  checks int := 0;
BEGIN
  SELECT su.uid INTO admin_uid FROM public.saas_users su WHERE su.role = 'super_admin' AND coalesce(su.is_active, true) LIMIT 1;
  SELECT t.id, t.owner_uid INTO a FROM public.tenants t WHERE t.owner_uid IS NOT NULL ORDER BY t.created_at LIMIT 1;
  SELECT t.id, t.owner_uid INTO b FROM public.tenants t WHERE t.owner_uid IS NOT NULL AND t.id <> a.id ORDER BY t.created_at LIMIT 1;
  IF admin_uid IS NULL OR a.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'SKIP: need an admin and two shops'; END IF;

  INSERT INTO public.plans (id, name, price, features, max_staff, max_orders, is_active, billing_period)
  VALUES ('zz_monthly_check', 'شهرية', 99, '[]', 2, 100, true, 'month');
  UPDATE public.tenants SET subscription_end_date = end0 WHERE id = a.id;
  SELECT count(*) INTO sales_before FROM public.payments WHERE tenant_id = a.id;

  INSERT INTO public.subscription_requests (tenant_id, plan_id, plan_name, amount, payment_method, status, reference_no)
  VALUES (a.id, 'zz_monthly_check', 'شهرية', 99, 'bank_transfer', 'pending', 'CHK-M') RETURNING id INTO req_m;
  INSERT INTO public.subscription_requests (tenant_id, plan_id, plan_name, amount, payment_method, status, reference_no)
  VALUES (b.id, 'basic', 'الخطة الأساسية', 999, 'bank_transfer', 'pending', 'CHK-Y') RETURNING id INTO req_y;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  PERFORM set_config('request.jwt.claim.sub', admin_uid, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.approve_subscription_request(req_m);
  PERFORM public.approve_subscription_request(req_y);
  RESET ROLE;

  -- 1. A monthly plan adds a month to the current end (not a year).
  IF (SELECT subscription_end_date FROM public.tenants WHERE id = a.id) <> end0 + interval '1 month' THEN
    RAISE EXCEPTION 'FAIL monthly end: %', (SELECT subscription_end_date FROM public.tenants WHERE id = a.id);
  END IF;
  checks := checks + 1;
  -- 2. A yearly plan adds a year from at least today.
  IF (SELECT subscription_end_date FROM public.tenants WHERE id = b.id) < now() + interval '1 year' - interval '1 minute' THEN
    RAISE EXCEPTION 'FAIL yearly end';
  END IF;
  checks := checks + 1;
  -- 3. The non-basic plan's payment is recorded too, with the period and a receipt number.
  SELECT * INTO led FROM public.saas_subscription_payments WHERE request_id = req_m;
  IF led IS NULL OR led.amount <> 99 OR led.period_start <> end0 OR led.period_end <> end0 + interval '1 month' OR led.receipt_number !~ '^SUB-[0-9]{6,}$' THEN
    RAISE EXCEPTION 'FAIL ledger row: %', row_to_json(led);
  END IF;
  checks := checks + 1;
  -- 4. Nothing is added to the shop's own sales payments.
  IF (SELECT count(*) FROM public.payments WHERE tenant_id = a.id) <> sales_before THEN RAISE EXCEPTION 'FAIL a sales payment was written'; END IF;
  checks := checks + 1;
  -- 5. Receipt numbers differ.
  IF (SELECT count(DISTINCT receipt_number) FROM public.saas_subscription_payments WHERE request_id IN (req_m, req_y)) <> 2 THEN RAISE EXCEPTION 'FAIL receipt numbers'; END IF;
  checks := checks + 1;

  -- 6. The owner of A sees A's receipt and not B's, and cannot write one.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a.owner_uid::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.saas_subscription_payments WHERE request_id = req_y;
  IF n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'FAIL another shop''s receipt is visible'; END IF;
  SELECT count(*) INTO n FROM public.saas_subscription_payments WHERE request_id = req_m;
  IF n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'FAIL own receipt not visible'; END IF;
  checks := checks + 2;
  BEGIN
    INSERT INTO public.saas_subscription_payments (tenant_id, amount) VALUES (a.id, 1);
    RESET ROLE; RAISE EXCEPTION 'FAIL the shop wrote a receipt';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;
  RESET ROLE;
  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
