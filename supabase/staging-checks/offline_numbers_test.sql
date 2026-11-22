-- seen-readiness-fixes-task.md P3.2 (20270104000000). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/offline_numbers_test.sql
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  BR uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  s_own uuid := gen_random_uuid();
  sh uuid := gen_random_uuid();
  blk jsonb;
  v jsonb;
  sold timestamptz := date_trunc('second', now() - interval '20 minutes');
  ord record; inv record;
  checks int := 0;
  sale jsonb;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test, vat_number, is_tax_enabled, default_tax_rate)
  VALUES (T, 'أرقام', 'nums@example.invalid', '0500000008', 'active', true, '300000000000003', true, 15);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (BR, T, 'main', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test)
  VALUES (s_own, T, own, 'owner', 'nums-own@example.invalid', 'owner', BR, 'active', true);
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
  VALUES (sh, T, BR, s_own, 'owner', 0, 'open', now() - interval '1 hour');
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  sale := jsonb_build_object('shift_id', sh, 'customer_name', 'W', 'status', 'delivered', 'payment_method', 'cash', 'paid_amount', 115, 'delivery_date', now()::text);

  -- 1. A block of 5, then an online sale takes the number after it.
  blk := public.reserve_offline_numbers('device-abc-123', 5);
  v := public.create_pos_sale(gen_random_uuid(), sale, '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
  IF (v->>'order_number')::bigint <> (blk->>'order_from')::bigint + 5
     OR v->>'invoice_number' <> 'INV-' || ((blk->>'invoice_from')::bigint + 5) THEN
    RAISE EXCEPTION 'FAIL the online sale used a reserved number: % / %', v, blk;
  END IF;
  checks := checks + 1;

  -- 2. An offline sale keeps its slot's numbers and the time it was made.
  v := public.create_pos_sale(gen_random_uuid(),
    sale || jsonb_build_object('sold_at', sold::text, 'offline_number', jsonb_build_object('block_id', blk->>'block_id', 'slot', 2)),
    '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
  SELECT * INTO ord FROM public.orders WHERE id = (v->>'order_id')::uuid;
  SELECT * INTO inv FROM public.tax_invoices WHERE order_id = ord.id;
  IF ord.order_number <> (blk->>'order_from')::bigint + 2 OR inv.invoice_number <> 'INV-' || ((blk->>'invoice_from')::bigint + 2)
     OR ord.order_date <> sold OR inv.issued_at <> sold
     OR inv.qr_payload <> public.zatca_qr_payload('أرقام', '300000000000003', sold, inv.total_amount::text, inv.tax_amount::text) THEN
    RAISE EXCEPTION 'FAIL offline sale: % % % %', ord.order_number, inv.invoice_number, ord.order_date, inv.issued_at;
  END IF;
  checks := checks + 1;

  -- 3. The same slot twice is refused; a slot outside the block too.
  BEGIN
    PERFORM public.create_pos_sale(gen_random_uuid(),
      sale || jsonb_build_object('offline_number', jsonb_build_object('block_id', blk->>'block_id', 'slot', 2)),
      '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'FAIL a slot used twice';
  EXCEPTION WHEN unique_violation THEN checks := checks + 1;
  END;
  BEGIN
    PERFORM public.create_pos_sale(gen_random_uuid(),
      sale || jsonb_build_object('offline_number', jsonb_build_object('block_id', blk->>'block_id', 'slot', 5)),
      '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'FAIL a slot outside the block';
  EXCEPTION WHEN invalid_parameter_value THEN checks := checks + 1;
  END;

  -- 4. A time in the future, or before the shift, is now.
  v := public.create_pos_sale(gen_random_uuid(), sale || jsonb_build_object('sold_at', (now() + interval '1 day')::text),
    '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
  IF (SELECT order_date FROM public.orders WHERE id = (v->>'order_id')::uuid) > now() + interval '1 minute' THEN RAISE EXCEPTION 'FAIL future time kept'; END IF;
  v := public.create_pos_sale(gen_random_uuid(), sale || jsonb_build_object('sold_at', (now() - interval '1 day')::text),
    '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
  IF (SELECT order_date FROM public.orders WHERE id = (v->>'order_id')::uuid) < now() - interval '1 hour' THEN RAISE EXCEPTION 'FAIL time before the shift kept'; END IF;
  v := public.create_pos_sale(gen_random_uuid(), sale || jsonb_build_object('sold_at', 'not a date'),
    '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
  checks := checks + 1;
  RESET ROLE;

  -- 5. Another shop's block is refused; a visitor cannot reserve.
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.reserve_offline_numbers('device-abc-123', 5);
    RAISE EXCEPTION 'FAIL a visitor reserved numbers';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;
  RESET ROLE;
  UPDATE public.offline_number_blocks SET tenant_id = (SELECT id FROM public.tenants WHERE id <> T LIMIT 1) WHERE id = (blk->>'block_id')::uuid;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.create_pos_sale(gen_random_uuid(),
      sale || jsonb_build_object('offline_number', jsonb_build_object('block_id', blk->>'block_id', 'slot', 3)),
      '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
    RAISE EXCEPTION 'FAIL another shop''s block used';
  EXCEPTION WHEN invalid_parameter_value THEN checks := checks + 1;
  END;
  RESET ROLE;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
