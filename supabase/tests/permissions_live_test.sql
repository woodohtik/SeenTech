-- seen-permissions-fix-task.md Phase 6 (20270101000006_permissions_live).
--   npx supabase db query --linked --file supabase/tests/permissions_live_test.sql
-- Rolled back.
DO $test$
DECLARE
  T uuid := gen_random_uuid();
  s_cash uuid := gen_random_uuid();
  own text := gen_random_uuid()::text;
  tok text := 'live-' || gen_random_uuid();
  checks int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'roles')
     OR NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'user_permission_overrides') THEN
    RAISE EXCEPTION 'FAIL roles / overrides are not on Realtime';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'staff') THEN
    RAISE EXCEPTION 'FAIL staff (pin_hash) is on Realtime';
  END IF;
  checks := checks + 1;

  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES (T, 'live', 'live@example.invalid', '0500000050', 'active', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, status, is_test) VALUES
    (gen_random_uuid(), T, own, 'owner', 'l-own@example.invalid', 'owner', 'active', true),
    (s_cash, T, NULL, 'cashier', 'l-cash@example.invalid', 'cashier', 'active', true);
  INSERT INTO public.staff_acting_sessions (token_hash, tenant_id, auth_uid, staff_id, expires_at)
  VALUES (encode(sha256(convert_to(tok, 'UTF8')), 'hex'), T, own, s_cash, now() + interval '1 hour');
  SET LOCAL session_replication_role = origin;

  UPDATE public.staff SET status = 'inactive' WHERE id = s_cash;
  IF EXISTS (SELECT 1 FROM public.staff_acting_sessions WHERE staff_id = s_cash AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'FAIL deactivating did not end the PIN sessions';
  END IF;
  checks := checks + 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.headers', json_build_object('x-seen-acting-staff', tok)::text, true);
  IF (public.get_my_permissions()->>'session_invalid')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL the device is not told';
  END IF;
  checks := checks + 1;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
