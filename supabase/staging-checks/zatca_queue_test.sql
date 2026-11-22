-- seen-readiness-fixes-task.md P2.4 (20270103000000). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/zatca_queue_test.sql
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  B uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  s_own uuid := gen_random_uuid();
  sh uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  v jsonb;
  o uuid;
  q record;
  n int;
  checks int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vat_number, is_tax_enabled, default_tax_rate)
  VALUES (T, 'طابور', 'queue@example.invalid', '0500000005', 'active', true, '300000000000003', true, 15);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (B, T, 'main', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test)
  VALUES (s_own, T, own, 'owner', 'q-own@example.invalid', 'owner', B, 'active', true);
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
  VALUES (sh, T, B, s_own, 'owner', 0, 'open', now());
  INSERT INTO public.customers (id, tenant_id, name, phone, is_test) VALUES (c, T, 'c', '0500000006', true);
  SET LOCAL session_replication_role = origin;

  -- 1. A POS sale's invoice and a credit note are queued by themselves.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh, 'customer_name', 'W', 'status', 'delivered', 'payment_method', 'cash', 'paid_amount', 115, 'delivery_date', now()::text),
    '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
  o := (v->>'order_id')::uuid;
  PERFORM public.issue_credit_note(gen_random_uuid(), (SELECT id FROM public.tax_invoices WHERE order_id = o), 10, 'x', 'cash');
  -- The browser cannot touch the queue.
  BEGIN
    UPDATE public.zatca_submissions SET status = 'sent' WHERE tenant_id = T;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE EXCEPTION 'FAIL the browser edited the queue'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  IF (SELECT count(*) FROM public.zatca_submissions WHERE tenant_id = T AND status = 'pending') <> 2 THEN
    RAISE EXCEPTION 'FAIL expected the invoice and the credit note queued, got %',
      (SELECT json_agg(json_build_object('k', kind, 's', status)) FROM public.zatca_submissions WHERE tenant_id = T);
  END IF;
  checks := checks + 2;

  -- 2. The worker claims them; a failed send waits, then gives up as "failed" after 30 tries.
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO n FROM public.zatca_claim_submissions(500) s WHERE s.tenant_id = T;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL claimed % of 2', n; END IF;
  SELECT * INTO q FROM public.zatca_submissions WHERE tenant_id = T AND kind = 'invoice';
  PERFORM public.zatca_finish_submission(q.id, 'retry', 'network down', NULL);
  SELECT * INTO q FROM public.zatca_submissions WHERE id = q.id;
  IF q.status <> 'retry' OR q.next_attempt_at < now() + interval '90 seconds' OR q.last_error <> 'network down' THEN
    RAISE EXCEPTION 'FAIL retry: % %', q.status, q.next_attempt_at;
  END IF;
  UPDATE public.zatca_submissions SET attempts = 30 WHERE id = q.id;
  PERFORM public.zatca_finish_submission(q.id, 'retry', 'still down', NULL);
  IF (SELECT status FROM public.zatca_submissions WHERE id = q.id) <> 'failed' THEN RAISE EXCEPTION 'FAIL never gives up'; END IF;
  RESET ROLE;
  checks := checks + 2;

  -- 3. The browser cannot call the worker's functions.
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.zatca_claim_submissions(1);
    RAISE EXCEPTION 'FAIL the browser claimed the queue';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;
  RESET ROLE;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
