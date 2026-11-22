-- seen-readiness-fixes-task.md P2.1/P2.2 (20270103000001). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/zatca_documents_at_issue_test.sql
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  B uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  s_own uuid := gen_random_uuid();
  sh uuid := gen_random_uuid();
  v jsonb;
  o1 uuid; o2 uuid;
  i1 record; i2 record; cn record;
  st jsonb;
  n int;
  checks int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vat_number, is_tax_enabled, default_tax_rate)
  VALUES (T, 'سلسلة', 'chain@example.invalid', '0500000007', 'active', true, '300000000000003', true, 15);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (B, T, 'main', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test)
  VALUES (s_own, T, own, 'owner', 'chain-own@example.invalid', 'owner', B, 'active', true);
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
  VALUES (sh, T, B, s_own, 'owner', 0, 'open', now());
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh, 'customer_name', 'W', 'status', 'delivered', 'payment_method', 'cash', 'paid_amount', 172.5, 'delivery_date', now()::text),
    '[{"type":"custom","name":"ثوب","price":100,"quantity":1},{"type":"custom","name":"شماغ","price":25,"quantity":2}]'::jsonb, '{}'::jsonb);
  o1 := (v->>'order_id')::uuid;
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh, 'customer_name', 'W', 'status', 'delivered', 'payment_method', 'cash', 'paid_amount', 23, 'delivery_date', now()::text),
    '[{"type":"custom","name":"زر","price":20,"quantity":1}]'::jsonb, '{}'::jsonb);
  o2 := (v->>'order_id')::uuid;
  PERFORM public.issue_credit_note(gen_random_uuid(), (SELECT id FROM public.tax_invoices WHERE order_id = o1), 57.5, 'إرجاع شماغ', 'cash');

  -- 1. A credit note cannot be edited or deleted from the browser (ZATCA-14).
  BEGIN
    UPDATE public.sales_returns SET reason = 'x' WHERE tenant_id = T;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE EXCEPTION 'FAIL the browser edited a credit note'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  checks := checks + 1;
  -- 2. Nor can it take the signing turn.
  BEGIN
    PERFORM public.zatca_signing_begin(T, now() - interval '1 day', 10);
    RAISE EXCEPTION 'FAIL the browser took the signing turn';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;
  RESET ROLE;

  -- 3. Each document got the next ICV, a UUID, and its lines fixed as charged.
  SELECT * INTO i1 FROM public.tax_invoices WHERE order_id = o1;
  SELECT * INTO i2 FROM public.tax_invoices WHERE order_id = o2;
  SELECT * INTO cn FROM public.sales_returns WHERE tenant_id = T;
  IF i1.icv <> 1 OR i2.icv <> 2 OR cn.icv <> 3 OR i1.zatca_uuid IS NULL OR cn.zatca_uuid IS NULL THEN
    RAISE EXCEPTION 'FAIL icv/uuid: % % % / % %', i1.icv, i2.icv, cn.icv, i1.zatca_uuid, cn.zatca_uuid;
  END IF;
  checks := checks + 1;
  IF jsonb_array_length(i1.lines) <> 2
     OR (SELECT sum((l->>'net')::numeric) FROM jsonb_array_elements(i1.lines) l) <> i1.subtotal
     OR (SELECT sum((l->>'tax')::numeric) FROM jsonb_array_elements(i1.lines) l) <> i1.tax_amount THEN
    RAISE EXCEPTION 'FAIL invoice lines % vs % / %', i1.lines, i1.subtotal, i1.tax_amount;
  END IF;
  IF (cn.lines->0->>'net')::numeric <> 50 OR (cn.lines->0->>'tax')::numeric <> 7.5 THEN
    RAISE EXCEPTION 'FAIL credit note lines %', cn.lines;
  END IF;
  checks := checks + 1;
  -- Editing the order afterwards does not touch the invoice's lines.
  UPDATE public.order_items SET name = 'غيّر' WHERE order_id = o1;
  IF (SELECT lines FROM public.tax_invoices WHERE id = i1.id) <> i1.lines THEN RAISE EXCEPTION 'FAIL lines follow the order'; END IF;
  checks := checks + 1;

  -- 4. Signing goes strictly in ICV order, with the chain's PIH.
  SET LOCAL ROLE service_role;
  st := public.zatca_signing_begin(T, now() - interval '1 day', 10);
  IF st->>'pih' <> 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='
     OR jsonb_array_length(st->'pending') <> 3 OR (st->'pending'->0->>'icv')::int <> 1 OR st->'pending'->2->>'kind' <> 'credit_note' THEN
    RAISE EXCEPTION 'FAIL begin: %', st;
  END IF;
  IF public.zatca_signing_begin(T, now() - interval '1 day', 10) IS NOT NULL THEN RAISE EXCEPTION 'FAIL two signers at once'; END IF;
  checks := checks + 2;
  BEGIN
    PERFORM public.zatca_signing_store(T, (st->>'token')::uuid, 'invoice', i2.id, 2, st->>'pih', 'H2', '<x/>', NULL);
    RAISE EXCEPTION 'FAIL signed out of order';
  EXCEPTION WHEN invalid_parameter_value THEN checks := checks + 1;
  END;
  BEGIN
    PERFORM public.zatca_signing_store(T, (st->>'token')::uuid, 'invoice', i1.id, 1, 'WRONG', 'H1', '<x/>', NULL);
    RAISE EXCEPTION 'FAIL signed with a stale PIH';
  EXCEPTION WHEN invalid_parameter_value THEN checks := checks + 1;
  END;
  PERFORM public.zatca_signing_store(T, (st->>'token')::uuid, 'invoice', i1.id, 1, st->>'pih', 'H1', '<x/>', 'QR1');
  PERFORM public.zatca_signing_store(T, (st->>'token')::uuid, 'invoice', i2.id, 2, 'H1', 'H2', '<y/>', 'QR2');
  PERFORM public.zatca_signing_end(T, (st->>'token')::uuid);
  st := public.zatca_signing_begin(T, now() - interval '1 day', 10);
  IF st->>'pih' <> 'H2' OR jsonb_array_length(st->'pending') <> 1 OR (st->'pending'->0->>'id')::uuid <> cn.id THEN
    RAISE EXCEPTION 'FAIL resume: %', st;
  END IF;
  IF (SELECT previous_invoice_hash FROM public.tax_invoices WHERE id = i2.id) <> 'H1'
     OR (SELECT signed_xml FROM public.tax_invoices WHERE id = i1.id) <> '<x/>' THEN
    RAISE EXCEPTION 'FAIL stored';
  END IF;
  PERFORM public.zatca_signing_end(T, (st->>'token')::uuid);
  RESET ROLE;
  checks := checks + 2;

  -- 5. The Phase 1 QR has no line breaks (ZATCA-12).
  IF public.zatca_qr_payload(repeat('مشغل ', 20), '300000000000003', now(), '1150.00', '150.00') ~ E'[\n\r]' THEN
    RAISE EXCEPTION 'FAIL the QR has a line break';
  END IF;
  checks := checks + 1;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
