-- Phase 0 gate (seen-verticals-readiness-task.md): run on staging with
--   npx supabase db query --linked --file supabase/tests/verticals_readiness_gate_test.sql
-- Ends with an exception on purpose so every change rolls back.
DO $test$
DECLARE
  a record;
  checks int := 0;
BEGIN
  SELECT id, owner_uid, vertical INTO a FROM public.tenants WHERE owner_uid IS NOT NULL ORDER BY created_at LIMIT 1;
  IF a.id IS NULL THEN RAISE EXCEPTION 'SKIP: need a shop with an owner'; END IF;
  IF (SELECT readiness FROM public.verticals WHERE key = 'mens_tailoring') <> 'ready' THEN RAISE EXCEPTION 'FAIL: mens_tailoring not ready'; END IF;
  IF EXISTS (SELECT 1 FROM public.verticals WHERE key <> 'mens_tailoring' AND readiness <> 'coming_soon') THEN
    RAISE EXCEPTION 'FAIL: another vertical is not coming_soon';
  END IF;
  checks := checks + 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a.owner_uid::text, true);

  -- 1. The owner cannot move the shop to a vertical that is not ready.
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.tenants SET vertical = 'furniture' WHERE id = a.id;
    RESET ROLE;
    RAISE EXCEPTION 'FAIL: owner moved to a coming_soon vertical';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    checks := checks + 1;
  END;

  -- 2. Saving the shop without touching the vertical still works (onboarding
  --    sends the same value back).
  SET LOCAL ROLE authenticated;
  UPDATE public.tenants SET vertical = a.vertical, name = name WHERE id = a.id;
  RESET ROLE;
  checks := checks + 1;

  -- 3. A shop already on a coming_soon vertical keeps it: other edits pass.
  UPDATE public.tenants SET vertical = 'womens_tailoring' WHERE id = a.id;  -- as the system
  SET LOCAL ROLE authenticated;
  UPDATE public.tenants SET name = name, vertical = 'womens_tailoring' WHERE id = a.id;
  RESET ROLE;
  IF (SELECT vertical FROM public.tenants WHERE id = a.id) <> 'womens_tailoring' THEN RAISE EXCEPTION 'FAIL: existing vertical lost'; END IF;
  checks := checks + 1;

  -- 4. ...and can move back to a ready vertical.
  SET LOCAL ROLE authenticated;
  UPDATE public.tenants SET vertical = 'mens_tailoring' WHERE id = a.id;
  RESET ROLE;
  checks := checks + 1;

  -- 5. beta is the platform admin's only: the owner cannot choose it.
  UPDATE public.verticals SET readiness = 'beta' WHERE key = 'fabric_store';
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.tenants SET vertical = 'fabric_store' WHERE id = a.id;
    RESET ROLE;
    RAISE EXCEPTION 'FAIL: owner chose a beta vertical';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    checks := checks + 1;
  END;

  -- 6. A ready vertical can be chosen.
  UPDATE public.verticals SET readiness = 'ready' WHERE key = 'fabric_store';
  SET LOCAL ROLE authenticated;
  UPDATE public.tenants SET vertical = 'fabric_store' WHERE id = a.id;
  RESET ROLE;
  checks := checks + 1;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
