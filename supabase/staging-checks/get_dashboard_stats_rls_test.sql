-- get_dashboard_stats(): RLS test (seen-performance-first-open-login-task.md Phase 4.3).
-- Run on staging: npx supabase db query --linked --file supabase/staging-checks/get_dashboard_stats_rls_test.sql
-- As an active staff member of shop A (authenticated + their JWT sub):
--  - their own shop's figures match what the database owner sees;
--  - asking for shop B (a shop with orders) returns nothing of B: zeros.
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

  own_as_owner := public.get_dashboard_stats(a.tenant_id, NULL, '[]'::jsonb, NULL, now() - interval '60 days');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a.uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a.uid, true);
  SET LOCAL ROLE authenticated;
  own_as_staff := public.get_dashboard_stats(a.tenant_id, NULL, '[]'::jsonb, NULL, now() - interval '60 days');
  other := public.get_dashboard_stats(b_tenant, NULL,
             jsonb_build_array(jsonb_build_object('s', '2000-01-01T00:00:00Z', 'e', '2100-01-01T00:00:00Z', 'inc', true)),
             NULL, now() - interval '60 days');
  RESET ROLE;

  IF (own_as_staff->'totals'->>'orders')::int <> (own_as_owner->'totals'->>'orders')::int THEN
    RAISE EXCEPTION 'FAIL: own shop orders differ (% vs %)', own_as_staff->'totals'->>'orders', own_as_owner->'totals'->>'orders';
  END IF; checks := checks + 1;
  IF (own_as_staff->'totals'->>'orders')::int = 0 THEN RAISE EXCEPTION 'FAIL: own shop shows no orders'; END IF; checks := checks + 1;
  IF (other->'totals'->>'orders')::int <> 0 THEN RAISE EXCEPTION 'FAIL: shop B orders visible: %', other->'totals'->>'orders'; END IF; checks := checks + 1;
  IF (other->'ranges'->0->>'orders')::int <> 0 OR (other->'ranges'->0->>'paid')::numeric <> 0 THEN RAISE EXCEPTION 'FAIL: shop B range visible'; END IF; checks := checks + 1;
  IF (other->>'customers_total')::int <> 0 THEN RAISE EXCEPTION 'FAIL: shop B customers visible'; END IF; checks := checks + 1;
  IF (other->'filtered'->>'paid')::numeric <> 0 THEN RAISE EXCEPTION 'FAIL: shop B revenue visible'; END IF; checks := checks + 1;

  -- Anonymous: refused.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  BEGIN
    SET LOCAL ROLE anon;
    other := public.get_dashboard_stats(a.tenant_id, NULL, '[]'::jsonb, NULL, NULL);
    RESET ROLE;
    RAISE EXCEPTION 'FAIL: anon could call get_dashboard_stats';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    checks := checks + 1;
  END;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
