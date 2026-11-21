-- seen-permissions-fix-task.md Phase 1 (20270101000000_permissions_single_source).
--   npx supabase db query --linked --file supabase/staging-checks/permissions_single_source_test.sql
-- Rolled back (ends in RAISE EXCEPTION 'PASS: ...').
DO $test$
DECLARE
  TA uuid := gen_random_uuid();
  TB uuid := gen_random_uuid();
  r record;
  v_mismatch text;
  cash_a text := gen_random_uuid()::text;
  cash_b text := gen_random_uuid()::text;
  cust   text := gen_random_uuid()::text;
  ovr    text := gen_random_uuid()::text;
  own    text := gen_random_uuid()::text;
  sid_ovr uuid := gen_random_uuid();
  custom_role uuid := gen_random_uuid();
  v jsonb;
  checks int := 0;
BEGIN
  -- 1. The 12 keys the server checked before: the new defaults equal the old table, every role.
  SELECT string_agg(d.role_key || '/' || d.permission_key, ', ') INTO v_mismatch
    FROM public.role_default_permissions d
   WHERE d.role_key <> 'owner'
     AND d.permission_key IN ('orders.create','payments.collect','action.refund','action.discount','orders.delete',
                              'customers.delete','inventory.delete','staff.permissions','settings.billing',
                              'suppliers.manage','inventory.reconcile','shifts.manage')
     AND d.allowed IS DISTINCT FROM public.app_default_permission(d.role_key, d.permission_key);
  IF v_mismatch IS NOT NULL THEN RAISE EXCEPTION 'FAIL defaults differ from app_default_permission: %', v_mismatch; END IF;
  checks := checks + 1;
  IF (SELECT count(*) FROM public.role_default_permissions) <> 400 THEN RAISE EXCEPTION 'FAIL expected 8 x 50 rows'; END IF;
  checks := checks + 1;

  -- Fixtures: shop A (with an edited "cashier" role, a custom role, an override) and shop B.
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.tenants (id, name, owner_email, phone, status, owner_uid, is_test) VALUES
    (TA, 'perm A', 'perm-a@example.invalid', '0500000080', 'active', own, true),
    (TB, 'perm B', 'perm-b@example.invalid', '0500000081', 'active', gen_random_uuid()::text, true);
  INSERT INTO public.roles (tenant_id, role_key, name, permissions)
  VALUES (TA, 'cashier', 'كاشير (معدّل)', '{"action.refund": true, "action.discount": false}'::jsonb);
  INSERT INTO public.roles (id, tenant_id, role_key, name, permissions, base_role)
  VALUES (custom_role, TA, 'custom_senior', 'كاشير أول', '{"action.refund": true, "orders.update_status": true}'::jsonb, 'cashier');
  INSERT INTO public.staff (id, tenant_id, uid, name, email, role, role_id, status, is_test) VALUES
    (gen_random_uuid(), TA, own,    'owner',  'p-own@example.invalid',  'owner',   NULL, 'active', true),
    (gen_random_uuid(), TA, cash_a, 'cash A', 'p-ca@example.invalid',   'cashier', NULL, 'active', true),
    (gen_random_uuid(), TB, cash_b, 'cash B', 'p-cb@example.invalid',   'cashier', NULL, 'active', true),
    (gen_random_uuid(), TA, cust,   'custom', 'p-cu@example.invalid',   'cashier', custom_role, 'active', true),
    (sid_ovr,           TA, ovr,    'ovr',    'p-ov@example.invalid',   'tailor',  NULL, 'active', true);
  INSERT INTO public.user_permission_overrides (tenant_id, staff_id, overrides)
  VALUES (TA, sid_ovr, '{"payments.collect": true, "orders.update_status": false}'::jsonb);
  SET LOCAL session_replication_role = origin;

  -- 2. Editing "cashier" in shop A's settings reaches the server in A, not in B.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cash_a, 'role', 'authenticated')::text, true);
  IF NOT public.app_has_permission('action.refund') OR public.app_has_permission('action.discount') THEN
    RAISE EXCEPTION 'FAIL shop A cashier: the edited role is not applied';
  END IF;
  IF NOT public.app_has_permission('payments.collect') THEN RAISE EXCEPTION 'FAIL shop A cashier lost a default key'; END IF;
  checks := checks + 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cash_b, 'role', 'authenticated')::text, true);
  IF public.app_has_permission('action.refund') OR NOT public.app_has_permission('action.discount') THEN
    RAISE EXCEPTION 'FAIL shop B cashier changed by shop A''s edit';
  END IF;
  checks := checks + 1;

  -- 3. A custom role (role_id) wins over the shop's role_key row; missing keys fall back to the base role's defaults.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cust, 'role', 'authenticated')::text, true);
  IF NOT public.app_has_permission('orders.update_status') OR NOT public.app_has_permission('action.discount') THEN
    RAISE EXCEPTION 'FAIL custom role';
  END IF;
  checks := checks + 1;

  -- 4. A personal override wins over the role.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ovr, 'role', 'authenticated')::text, true);
  IF NOT public.app_has_permission('payments.collect') OR public.app_has_permission('orders.update_status')
     OR NOT public.app_has_permission('orders.view') THEN
    RAISE EXCEPTION 'FAIL override';
  END IF;
  checks := checks + 1;

  -- 5. get_my_permissions: the caller's map (50 keys); the owner gets every key.
  SET LOCAL ROLE authenticated;
  v := public.get_my_permissions();
  IF (SELECT count(*) FROM jsonb_object_keys(v->'permissions')) <> 50 OR (v->'permissions'->>'payments.collect')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL get_my_permissions for the override tailor: %', v;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', own, 'role', 'authenticated')::text, true);
  v := public.get_my_permissions();
  IF v->>'role' <> 'owner' OR EXISTS (SELECT 1 FROM jsonb_each(v->'permissions') e WHERE e.value <> 'true'::jsonb) THEN
    RAISE EXCEPTION 'FAIL get_my_permissions for the owner';
  END IF;
  checks := checks + 1;

  -- 6. The internal function is not callable from the browser.
  BEGIN
    PERFORM public.app_effective_permissions(sid_ovr);
    RAISE EXCEPTION 'FAIL app_effective_permissions is callable by authenticated';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;
  RESET ROLE;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
