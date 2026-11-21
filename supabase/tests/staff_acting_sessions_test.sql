-- seen-permissions-fix-task.md Phase 2 (20270101000001_staff_acting_sessions).
--   npx supabase db query --linked --file supabase/tests/staff_acting_sessions_test.sql
-- Rolled back (ends in RAISE EXCEPTION 'PASS: ...'). No account is created:
-- staff rows are named in request.jwt.claims, the PIN token in request.headers.
DO $test$
DECLARE
  TA uuid := gen_random_uuid();
  TB uuid := gen_random_uuid();
  BA uuid := gen_random_uuid();
  own_a text := gen_random_uuid()::text;   -- shop A's owner account (the device)
  own_b text := gen_random_uuid()::text;   -- shop B's owner account
  mgr_a text := gen_random_uuid()::text;   -- another account in shop A
  s_own uuid := gen_random_uuid();
  s_cash uuid := gen_random_uuid();
  s_mgr uuid := gen_random_uuid();
  s_own_b uuid := gen_random_uuid();
  sh_cash uuid := gen_random_uuid();
  tok text := 'cashier-token-' || gen_random_uuid();
  tok_old text := 'expired-' || gen_random_uuid();
  tok_rev text := 'revoked-' || gen_random_uuid();
  v jsonb;
  v_ok boolean;
  checks int := 0;

  -- helper: run as account `uid` with an optional PIN token / offline actor
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, owner_uid, is_test) VALUES
    (TA, 'acting A', 'acting-a@example.invalid', '0500000070', 'active', own_a, true),
    (TB, 'acting B', 'acting-b@example.invalid', '0500000071', 'active', own_b, true);
  INSERT INTO public.branches (id, tenant_id, name, location, is_main) VALUES (BA, TA, 'main', 'x', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, branch_id, status, is_test) VALUES
    (s_own,   TA, own_a, 'مالك A',  'a-own@example.invalid',  'owner',   BA, 'active', true),
    (s_cash,  TA, NULL,  'كاشير A', 'a-cash@example.invalid', 'cashier', BA, 'active', true),
    (s_mgr,   TA, mgr_a, 'مدير A',  'a-mgr@example.invalid',  'manager', BA, 'active', true),
    (s_own_b, TB, own_b, 'مالك B',  'b-own@example.invalid',  'owner',   NULL, 'active', true);
  INSERT INTO public.shifts (id, tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
  VALUES (sh_cash, TA, BA, s_cash, 'كاشير A', 0, 'open', now());
  INSERT INTO public.staff_acting_sessions (token_hash, tenant_id, auth_uid, staff_id, created_at, expires_at, revoked_at) VALUES
    (encode(sha256(convert_to(tok, 'UTF8')), 'hex'),     TA, own_a, s_cash, now(), now() + interval '12 hours', NULL),
    (encode(sha256(convert_to(tok_old, 'UTF8')), 'hex'), TA, own_a, s_cash, now() - interval '13 hours', now() - interval '1 hour', NULL),
    (encode(sha256(convert_to(tok_rev, 'UTF8')), 'hex'), TA, own_a, s_cash, now(), now() + interval '1 hour', now());
  SET LOCAL session_replication_role = origin;

  -- 1. The owner's device with the cashier's PIN token: the server sees the cashier.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', own_a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.headers', json_build_object('x-seen-acting-staff', tok)::text, true);
  IF public.app_current_staff_id() <> s_cash OR public.app_current_role() <> 'cashier' THEN
    RAISE EXCEPTION 'FAIL the PIN session is not the identity';
  END IF;
  IF public.app_has_permission('action.refund') OR NOT public.app_has_permission('payments.collect') THEN
    RAISE EXCEPTION 'FAIL the cashier''s own permissions do not apply';
  END IF;
  checks := checks + 1;

  -- 2. A sale on that device is the cashier's (created_by, on the cashier's shift).
  SET LOCAL ROLE authenticated;
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh_cash, 'customer_name', 'W', 'status', 'ready', 'payment_method', 'cash', 'paid_amount', 100, 'delivery_date', now()::text),
    '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
  RESET ROLE;
  IF (SELECT created_by FROM public.orders WHERE id = (v->>'order_id')::uuid) <> s_cash THEN
    RAISE EXCEPTION 'FAIL the sale is not attributed to the cashier';
  END IF;
  checks := checks + 1;

  -- 3. Refused tokens: another shop's account, another account of the same shop, expired, revoked, inactive employee.
  FOR v IN SELECT jsonb_build_object('uid', x.uid, 'tok', x.tok, 'why', x.why) FROM (VALUES
      (own_b, tok,     'shop B account'),
      (mgr_a, tok,     'stolen to another account'),
      (own_a, tok_old, 'expired'),
      (own_a, tok_rev, 'revoked'),
      (own_a, 'never-issued', 'unknown')) AS x(uid, tok, why) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v->>'uid', 'role', 'authenticated')::text, true);
    PERFORM set_config('request.headers', json_build_object('x-seen-acting-staff', v->>'tok')::text, true);
    -- Never the device account: no identity, no role, no permission; the UI is told.
    IF public.app_current_staff_id() IS NOT NULL OR public.app_current_role() IS NOT NULL
       OR public.app_has_permission('orders.view') OR (public.get_my_permissions()->>'session_invalid')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'FAIL token accepted: %', v->>'why';
    END IF;
    checks := checks + 1;
  END LOOP;
  PERFORM set_config('request.headers', '{}', true);
  UPDATE public.staff SET status = 'inactive' WHERE id = s_cash;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', own_a, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.headers', json_build_object('x-seen-acting-staff', tok)::text, true);
  IF public.app_has_permission('payments.collect') OR public.app_current_staff_id() IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL token accepted for an inactive employee';
  END IF;
  checks := checks + 1;
  PERFORM set_config('request.headers', '{}', true);
  UPDATE public.staff SET status = 'active' WHERE id = s_cash;

  -- 4. No token: the device account, as before.
  PERFORM set_config('request.headers', '{}', true);
  IF public.app_current_staff_id() <> s_own OR public.app_current_role() <> 'owner' THEN
    RAISE EXCEPTION 'FAIL without a token the account is the identity';
  END IF;
  checks := checks + 1;

  -- 5. Offline replay: permissions stay the device account's; the sale is the cashier's and marked offline.
  PERFORM set_config('request.headers', json_build_object('x-seen-offline-actor', s_cash)::text, true);
  IF public.app_current_staff_id() <> s_own OR public.app_actor_staff_id() <> s_cash THEN
    RAISE EXCEPTION 'FAIL offline actor: identity % actor %', public.app_current_staff_id(), public.app_actor_staff_id();
  END IF;
  SET LOCAL ROLE authenticated;
  v := public.create_pos_sale(gen_random_uuid(),
    jsonb_build_object('shift_id', sh_cash, 'customer_name', 'W', 'status', 'ready', 'payment_method', 'cash', 'paid_amount', 100, 'delivery_date', now()::text),
    '[{"type":"custom","name":"x","price":100,"quantity":1}]'::jsonb, '{}'::jsonb);
  RESET ROLE;
  IF (SELECT created_by FROM public.orders WHERE id = (v->>'order_id')::uuid) <> s_cash THEN
    RAISE EXCEPTION 'FAIL the offline sale is not attributed to the cashier';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_history h WHERE h.order_id = (v->>'order_id')::uuid AND h.notes LIKE '%سُجّلت بدون اتصال%') THEN
    RAISE EXCEPTION 'FAIL the offline sale is not marked in the history';
  END IF;
  checks := checks + 1;

  -- 6. An offline actor from another shop is ignored (attributed to the account).
  PERFORM set_config('request.headers', json_build_object('x-seen-offline-actor', s_own_b)::text, true);
  IF public.app_actor_staff_id() <> s_own THEN RAISE EXCEPTION 'FAIL another shop''s offline actor accepted'; END IF;
  checks := checks + 1;

  -- 7. The browser cannot read or write the sessions.
  PERFORM set_config('request.headers', '{}', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM 1 FROM public.staff_acting_sessions LIMIT 1;
    RAISE EXCEPTION 'FAIL authenticated can read staff_acting_sessions';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;
  RESET ROLE;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
