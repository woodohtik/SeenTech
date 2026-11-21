-- tenants.tax_settings, tenant_tax_rules and the sync trigger
-- (migration 20261230000000; team review M-8 / action 17).
-- Run on staging: npx supabase db query --linked --file supabase/staging-checks/tenant_tax_settings_test.sql
-- Ends with an exception on purpose so every change rolls back: the message
-- says PASS or FAIL.
DO $test$
DECLARE
  a record;
  b_tenant uuid;
  r record;
  t record;
  n int;
  checks int := 0;
BEGIN
  SELECT id, owner_uid INTO a FROM public.tenants WHERE owner_uid IS NOT NULL ORDER BY created_at LIMIT 1;
  SELECT id INTO b_tenant FROM public.tenants WHERE id <> a.id ORDER BY created_at LIMIT 1;
  IF a.id IS NULL OR b_tenant IS NULL THEN RAISE EXCEPTION 'SKIP: need two shops'; END IF;

  -- 1. The owner saves settings straight to the column (the Settings screen's
  --    fallback path): allowed, copied to legacy_id and to the POS columns.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a.owner_uid::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.tenants
     SET tax_settings = '{"enabled": false, "vatRate": 5, "tailoringTaxType": "inclusive", "trn": "300000000000003"}'::jsonb
   WHERE id = a.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: owner could not save tax_settings (% rows)', n; END IF; checks := checks + 1;
  SELECT * INTO t FROM public.tenants WHERE id = a.id;
  IF t.legacy_id::jsonb IS DISTINCT FROM t.tax_settings THEN RAISE EXCEPTION 'FAIL: legacy_id not in step: %', t.legacy_id; END IF; checks := checks + 1;
  IF t.is_tax_enabled IS DISTINCT FROM false OR t.default_tax_rate <> 5 THEN
    RAISE EXCEPTION 'FAIL: POS columns not in step: % %', t.is_tax_enabled, t.default_tax_rate;
  END IF; checks := checks + 1;
  SELECT * INTO r FROM public.tenant_tax_rules(a.id);
  IF (r.enabled, r.tax_type, r.rate_pct) IS DISTINCT FROM (false, 'inclusive', 5::numeric) THEN
    RAISE EXCEPTION 'FAIL: rules %', r;
  END IF; checks := checks + 1;

  -- 2. The owner still cannot write legacy_id directly (not on the allowlist).
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.tenants SET legacy_id = '{"vatRate": 1}' WHERE id = a.id;
    RESET ROLE;
    RAISE EXCEPTION 'FAIL: owner wrote legacy_id directly';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    checks := checks + 1;
  END;

  -- 3. Another shop's settings: the owner's update reaches no row.
  SET LOCAL ROLE authenticated;
  UPDATE public.tenants SET tax_settings = '{"vatRate": 1}'::jsonb WHERE id = b_tenant;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: owner of A updated shop B'; END IF; checks := checks + 1;

  -- 4. An older server that still writes legacy_id: the column follows.
  UPDATE public.tenants SET legacy_id = '{"enabled": true, "vatRate": 10, "tailoringTaxType": "exempt"}' WHERE id = a.id;
  SELECT * INTO t FROM public.tenants WHERE id = a.id;
  IF t.tax_settings->>'vatRate' <> '10' OR t.is_tax_enabled IS DISTINCT FROM true OR t.default_tax_rate <> 10 THEN
    RAISE EXCEPTION 'FAIL: legacy_id write not followed: % % %', t.tax_settings, t.is_tax_enabled, t.default_tax_rate;
  END IF; checks := checks + 1;
  SELECT * INTO r FROM public.tenant_tax_rules(a.id);
  IF (r.enabled, r.tax_type, r.rate_pct) IS DISTINCT FROM (true, 'exempt', 10::numeric) THEN RAISE EXCEPTION 'FAIL: rules after legacy write %', r; END IF;
  checks := checks + 1;

  -- 5. A stored rate of 0 still means "not set": 15.
  UPDATE public.tenants SET tax_settings = '{"enabled": true, "vatRate": 0}'::jsonb WHERE id = a.id;
  SELECT * INTO r FROM public.tenant_tax_rules(a.id);
  SELECT * INTO t FROM public.tenants WHERE id = a.id;
  IF r.rate_pct <> 15 OR t.default_tax_rate <> 15 THEN RAISE EXCEPTION 'FAIL: zero rate % %', r.rate_pct, t.default_tax_rate; END IF;
  checks := checks + 1;

  -- 6. A real (non-JSON) legacy id is left alone.
  UPDATE public.tenants SET legacy_id = 'OLD-42' WHERE id = a.id;
  UPDATE public.tenants SET tax_settings = '{"enabled": true, "vatRate": 15}'::jsonb WHERE id = a.id;
  SELECT * INTO t FROM public.tenants WHERE id = a.id;
  IF t.legacy_id <> 'OLD-42' THEN RAISE EXCEPTION 'FAIL: non-JSON legacy id overwritten: %', t.legacy_id; END IF;
  checks := checks + 1;

  -- 7. Anonymous cannot read the rules.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.tenant_tax_rules(a.id);
    RESET ROLE;
    RAISE EXCEPTION 'FAIL: anon could call tenant_tax_rules';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    checks := checks + 1;
  END;

  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
