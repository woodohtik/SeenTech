-- Security audit 2026-11-22, batch 4 (20270112000003). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/audit_batch4_offline_actor_test.sql
DO $test$
DECLARE
  ta uuid := gen_random_uuid();
  device text := gen_random_uuid()::text;   -- the shop's device account (cashier A)
  s_a uuid := gen_random_uuid();
  s_b uuid := gen_random_uuid();             -- cashier B, never unlocked this device
  s_c uuid := gen_random_uuid();             -- cashier C, unlocked it last week
  owner_a text := gen_random_uuid()::text;
  cust uuid := gen_random_uuid();
  link jsonb;
  stored uuid;
  saved jsonb;
  got uuid;
  ok boolean;
  results text[] := '{}';
  failed int := 0;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.users (id, email) VALUES (device, 'dev@x.test');
  INSERT INTO public.tenants (id, name, owner_email, phone, status) VALUES (ta, 'A', 'o@x.test', '0500000001', 'active');
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, status) VALUES
    (s_a, ta, device, 'A', 'dev@x.test', 'cashier', 'active'),
    (s_b, ta, gen_random_uuid()::text, 'B', 'b@x.test', 'cashier', 'active'),
    (s_c, ta, gen_random_uuid()::text, 'C', 'c@x.test', 'cashier', 'active');
  INSERT INTO public.users (id, email) VALUES (owner_a, 'own@x.test');
  INSERT INTO public.staff (tenant_id, uid, name, email, role, status) VALUES (ta, owner_a, 'owner', 'own@x.test', 'owner', 'active');
  INSERT INTO public.customers (id, tenant_id, name, phone) VALUES (cust, ta, 'customer', '0500000077');
  INSERT INTO public.staff_acting_sessions (token_hash, tenant_id, auth_uid, staff_id, created_at, expires_at)
    VALUES ('x', ta, device, s_c, now() - interval '7 days', now() - interval '7 days' + interval '12 hours');
  SET LOCAL session_replication_role = origin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', device, 'role', 'authenticated')::text, true);

  PERFORM set_config('request.headers', json_build_object('x-seen-offline-actor', s_b)::text, true);
  got := public.app_offline_actor_staff_id();
  ok := got IS NULL;
  results := results || format('S-16 a colleague who never unlocked this device is not taken: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  PERFORM set_config('request.headers', json_build_object('x-seen-offline-actor', s_c)::text, true);
  got := public.app_offline_actor_staff_id();
  ok := got = s_c;
  results := results || format('regression: an employee who unlocked this device is still credited: %s', CASE WHEN ok THEN 'ok' ELSE 'BROKEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  PERFORM set_config('request.headers', json_build_object('x-seen-offline-actor', s_a)::text, true);
  got := public.app_offline_actor_staff_id();
  ok := got = s_a;
  results := results || format('regression: the device account''s own row is credited: %s', CASE WHEN ok THEN 'ok' ELSE 'BROKEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  -- S-33: the row keeps a digest of the link; the link itself still works.
  PERFORM set_config('request.headers', '{}', true);
  UPDATE public.tenants SET owner_uid = owner_a WHERE id = ta;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  link := public.issue_measurements_link(cust);
  RESET ROLE;
  SELECT measurements_token INTO stored FROM public.customers WHERE id = cust;
  ok := stored IS DISTINCT FROM (link ->> 'token')::uuid;
  results := results || format('S-33 the customer row does not hold the link: %s', CASE WHEN ok THEN 'ok' ELSE 'OPEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  saved := public.save_public_measurements((link ->> 'token')::uuid, '{"length": 140}'::jsonb);
  ok := (SELECT (measurements ->> 'length')::numeric FROM public.customers WHERE id = cust) = 140;
  results := results || format('regression: the link sent to the customer still saves: %s', CASE WHEN ok THEN 'ok' ELSE 'BROKEN' END);
  IF NOT ok THEN failed := failed + 1; END IF;

  RAISE EXCEPTION '% -- %', CASE WHEN failed = 0 THEN format('PASS: %s checks', array_length(results, 1)) ELSE format('FAIL: %s of %s', failed, array_length(results, 1)) END,
    array_to_string(results, ' | ');
END
$test$;
