-- get_session_identity(): RLS test (seen-performance-first-open-login-task.md Phase 3).
-- Run on staging:  npx supabase db query --linked --file supabase/staging-checks/get_session_identity_test.sql
-- Picks two active staff members of two different shops, then, as each of
-- them (authenticated role + their JWT sub), checks the function returns
-- their own shop and nothing of the other. Ends with an exception on
-- purpose so every setting rolls back: the message says PASS or FAIL.
DO $test$
DECLARE
  a record;
  b record;
  r jsonb;
  checks int := 0;
BEGIN
  SELECT s.uid, s.tenant_id INTO a FROM public.staff s
   JOIN public.users u ON u.id = s.uid
   WHERE s.status = 'active' AND s.uid IS NOT NULL ORDER BY s.created_at LIMIT 1;
  SELECT s.uid, s.tenant_id INTO b FROM public.staff s
   JOIN public.users u ON u.id = s.uid
   WHERE s.status = 'active' AND s.uid IS NOT NULL AND s.tenant_id <> a.tenant_id ORDER BY s.created_at LIMIT 1;
  IF a.uid IS NULL OR b.uid IS NULL THEN
    RAISE EXCEPTION 'SKIP: need active staff in two different shops';
  END IF;

  -- As shop A's staff member.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a.uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a.uid, true);
  SET LOCAL ROLE authenticated;
  r := public.get_session_identity();
  RESET ROLE;
  IF (r->'staff'->>'tenant_id')::uuid IS DISTINCT FROM a.tenant_id THEN RAISE EXCEPTION 'FAIL: A staff tenant %', r->'staff'->>'tenant_id'; END IF; checks := checks + 1;
  IF (r->'tenant'->>'id')::uuid IS DISTINCT FROM a.tenant_id THEN RAISE EXCEPTION 'FAIL: A tenant %', r->'tenant'->>'id'; END IF; checks := checks + 1;
  IF r->'user'->>'id' IS DISTINCT FROM a.uid THEN RAISE EXCEPTION 'FAIL: A user %', r->'user'->>'id'; END IF; checks := checks + 1;
  IF r::text LIKE '%' || b.tenant_id::text || '%' THEN RAISE EXCEPTION 'FAIL: shop B id visible to A'; END IF; checks := checks + 1;
  IF r->'staff' ? 'pin_hash' THEN RAISE EXCEPTION 'FAIL: pin_hash returned'; END IF; checks := checks + 1;

  -- As shop B's staff member.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b.uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', b.uid, true);
  SET LOCAL ROLE authenticated;
  r := public.get_session_identity();
  RESET ROLE;
  IF (r->'tenant'->>'id')::uuid IS DISTINCT FROM b.tenant_id THEN RAISE EXCEPTION 'FAIL: B tenant %', r->'tenant'->>'id'; END IF; checks := checks + 1;
  IF r::text LIKE '%' || a.tenant_id::text || '%' THEN RAISE EXCEPTION 'FAIL: shop A id visible to B'; END IF; checks := checks + 1;

  -- Anonymous: nothing at all.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    SET LOCAL ROLE anon;
    r := public.get_session_identity();
    RESET ROLE;
    RAISE EXCEPTION 'FAIL: anon could call get_session_identity';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    checks := checks + 1;
  END;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
