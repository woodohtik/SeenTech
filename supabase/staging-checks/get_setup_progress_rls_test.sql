-- get_setup_progress(): RLS test (seen-performance-first-open-login-task.md Phase 4.6).
-- Run on staging: npx supabase db query --linked --file supabase/staging-checks/get_setup_progress_rls_test.sql
-- As an active staff member of shop A (authenticated + their JWT sub):
--  - their own shop's answers match what the database owner sees;
--  - asking about shop B (a shop with orders) answers false for everything.
-- Ends with an exception on purpose so every setting rolls back.
DO $test$
DECLARE
  a record;
  b_tenant uuid;
  own_as_owner jsonb;
  own_as_staff jsonb;
  other jsonb;
  checks int := 0;
BEGIN
  SELECT s.uid, s.tenant_id INTO a FROM public.staff s
   JOIN public.users u ON u.id = s.uid
   WHERE s.status = 'active' AND s.uid IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.orders o WHERE o.tenant_id = s.tenant_id)
   ORDER BY s.created_at LIMIT 1;
  SELECT o.tenant_id INTO b_tenant FROM public.orders o
   WHERE o.tenant_id <> a.tenant_id GROUP BY o.tenant_id ORDER BY count(*) DESC LIMIT 1;
  IF a.uid IS NULL OR b_tenant IS NULL THEN
    RAISE EXCEPTION 'SKIP: need two shops with orders';
  END IF;

  own_as_owner := public.get_setup_progress(a.tenant_id);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a.uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a.uid, true);
  SET LOCAL ROLE authenticated;
  own_as_staff := public.get_setup_progress(a.tenant_id);
  other := public.get_setup_progress(b_tenant);
  RESET ROLE;

  IF (own_as_staff->>'has_orders')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: own shop shows no orders (%)', own_as_staff;
  END IF; checks := checks + 1;
  IF (own_as_owner->>'has_orders')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: owner view shows no orders (%)', own_as_owner;
  END IF; checks := checks + 1;
  IF other <> jsonb_build_object('has_stock', false, 'has_customers', false, 'has_orders', false, 'has_invoices', false) THEN
    RAISE EXCEPTION 'FAIL: shop B visible: %', other;
  END IF; checks := checks + 1;

  -- Anonymous: refused.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  BEGIN
    SET LOCAL ROLE anon;
    other := public.get_setup_progress(a.tenant_id);
    RESET ROLE;
    RAISE EXCEPTION 'FAIL: anon could call get_setup_progress';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    checks := checks + 1;
  END;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
