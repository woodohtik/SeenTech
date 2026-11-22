-- seen-readiness-fixes-task.md P4 (20270105000006). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/whatsapp_settings_test.sql
DO $t$
DECLARE T uuid := gen_random_uuid(); own text := gen_random_uuid()::text; cas text := gen_random_uuid()::text; v jsonb;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test) VALUES (T, 'وا', 'wa@example.invalid', '0500000020', 'active', true);
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, status, is_test) VALUES
    (gen_random_uuid(), T, own, 'o', 'wa-o@example.invalid', 'owner', 'active', true),
    (gen_random_uuid(), T, cas, 'c', 'wa-c@example.invalid', 'cashier', 'active', true);
  SET LOCAL session_replication_role = origin;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v := public.save_whatsapp_settings(false, 'مرحبا {customer_name}');
  RESET ROLE;
  IF (SELECT whatsapp_settings->>'enabled' FROM public.tenants WHERE id = T) <> 'false' THEN RAISE EXCEPTION 'FAIL not saved'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cas, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.save_whatsapp_settings(true, 'x'); RAISE EXCEPTION 'FAIL a cashier changed it';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  RAISE EXCEPTION 'PASS: 2 checks';
END $t$;
