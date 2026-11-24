-- Staging check for 20270113000000_public_measurements_keep_notes.sql.
-- Synthetic customer, rolled back. Ends with 'PASS: ...' or 'FAIL: ...'.
DO $$
DECLARE
  v_tenant uuid;
  v_customer uuid := gen_random_uuid();
  v_token uuid := gen_random_uuid();
  v_after jsonb;
  v_fails text[] := '{}';
BEGIN
  SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at LIMIT 1;
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.customers (id, tenant_id, name, phone, measurements, measurements_token, measurements_token_expires_at)
  VALUES (v_customer, v_tenant, 'check notes', '0500000099',
          '{"length": 145, "fieldNotes": {"length": "note kept", "shoulder": "slope"}}'::jsonb,
          public.measurements_token_digest(v_token), now() + interval '1 day');
  SET LOCAL session_replication_role = origin;

  -- The customer sends new values, and tries to send notes of their own.
  PERFORM public.save_public_measurements(v_token, '{"length": 150, "chest": 110, "fieldNotes": {"length": "from the link"}}'::jsonb);
  SELECT measurements INTO v_after FROM public.customers WHERE id = v_customer;

  IF (v_after->>'length')::numeric <> 150 OR (v_after->>'chest')::numeric <> 110 THEN v_fails := array_append(v_fails, 'values not saved'); END IF;
  IF v_after->'fieldNotes'->>'length' IS DISTINCT FROM 'note kept' THEN v_fails := array_append(v_fails, 'stored note changed or lost'); END IF;
  IF v_after->'fieldNotes'->>'shoulder' IS DISTINCT FROM 'slope' THEN v_fails := array_append(v_fails, 'second note lost'); END IF;

  -- A customer with no notes: the link writes none.
  UPDATE public.customers SET measurements = '{"length": 140}'::jsonb WHERE id = v_customer;
  PERFORM public.save_public_measurements(v_token, '{"length": 141, "fieldNotes": {"length": "x"}}'::jsonb);
  SELECT measurements INTO v_after FROM public.customers WHERE id = v_customer;
  IF v_after ? 'fieldNotes' THEN v_fails := array_append(v_fails, 'link wrote notes'); END IF;

  -- The Arabic text of both functions is readable again.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'save_public_measurements' AND prosrc LIKE '%تحديث مقاسات%') THEN
    v_fails := array_append(v_fails, 'notification text still garbled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'issue_measurements_link' AND prosrc LIKE '%تعديل العملاء%') THEN
    v_fails := array_append(v_fails, 'permission message still garbled');
  END IF;

  IF array_length(v_fails, 1) IS NULL THEN
    RAISE EXCEPTION 'PASS: 6 checks -- the link keeps the tailor notes, never writes its own, and the Arabic text is readable';
  ELSE
    RAISE EXCEPTION 'FAIL: %', array_to_string(v_fails, '; ');
  END IF;
END $$;
