-- admin_change_tenant_vertical (seen-verticals-readiness-task.md Phase 7.2), rolled back.
--   npx supabase db query --linked --file supabase/staging-checks/admin_change_tenant_vertical_test.sql
DO $test$
DECLARE
  admin_uid text;
  owner record;
  with_orders uuid;
  empty_shop uuid;
  r jsonb;
  checks int := 0;
BEGIN
  SELECT su.uid INTO admin_uid FROM public.saas_users su WHERE su.role = 'super_admin' AND coalesce(su.is_active, true) LIMIT 1;
  SELECT t.id INTO with_orders FROM public.tenants t WHERE EXISTS (SELECT 1 FROM public.orders o WHERE o.tenant_id = t.id) LIMIT 1;
  SELECT t.id, t.owner_uid INTO owner FROM public.tenants t
   WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.tenant_id = t.id) AND t.owner_uid IS NOT NULL LIMIT 1;
  empty_shop := owner.id;
  IF admin_uid IS NULL OR with_orders IS NULL OR empty_shop IS NULL THEN
    RAISE EXCEPTION 'SKIP: need a platform admin, a shop with orders and one without';
  END IF;

  -- 1. A shop owner cannot call it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', owner.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', owner.owner_uid::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.admin_change_tenant_vertical(empty_shop, 'furniture');
    RESET ROLE;
    RAISE EXCEPTION 'FAIL: an owner changed the vertical';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE; checks := checks + 1;
  END;

  -- As the platform admin.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  PERFORM set_config('request.jwt.claim.sub', admin_uid, true);

  -- 2. A shop with orders is refused.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.admin_change_tenant_vertical(with_orders, 'furniture');
    RESET ROLE;
    RAISE EXCEPTION 'FAIL: changed a shop that has orders';
  EXCEPTION WHEN check_violation THEN
    RESET ROLE; checks := checks + 1;
  END;

  -- 3. A shop without orders moves (even to a coming_soon activity), and it is logged.
  SET LOCAL ROLE authenticated;
  r := public.admin_change_tenant_vertical(empty_shop, 'furniture');
  RESET ROLE;
  IF (r->>'changed')::boolean IS NOT TRUE OR (SELECT vertical FROM public.tenants WHERE id = empty_shop) <> 'furniture' THEN
    RAISE EXCEPTION 'FAIL: not changed: %', r;
  END IF;
  checks := checks + 1;
  IF NOT EXISTS (SELECT 1 FROM public.saas_security_logs WHERE action = 'change_tenant_vertical' AND details LIKE '%' || empty_shop::text || '%' AND user_id = admin_uid) THEN
    RAISE EXCEPTION 'FAIL: no audit entry';
  END IF;
  checks := checks + 1;

  -- 4. An unknown activity is refused.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.admin_change_tenant_vertical(empty_shop, 'nonexistent');
    RESET ROLE;
    RAISE EXCEPTION 'FAIL: unknown activity accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    RESET ROLE; checks := checks + 1;
  END;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
