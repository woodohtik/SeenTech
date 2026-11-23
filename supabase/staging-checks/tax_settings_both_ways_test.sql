-- seen-readiness-fixes-task.md P6 (20270108000004). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/tax_settings_both_ways_test.sql
DO $test$
DECLARE
  t uuid;
  checks int := 0;
BEGIN
  SELECT id INTO t FROM public.tenants ORDER BY created_at LIMIT 1;
  IF t IS NULL THEN RAISE EXCEPTION 'SKIP: need a shop'; END IF;
  -- 1. The columns alone change: tax_settings follows.
  UPDATE public.tenants SET is_tax_enabled = true, default_tax_rate = 5 WHERE id = t;
  IF (SELECT (tax_settings->>'enabled')::boolean IS TRUE AND (tax_settings->>'vatRate')::numeric = 5 FROM public.tenants WHERE id = t) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL tax_settings did not follow: %', (SELECT tax_settings FROM public.tenants WHERE id = t);
  END IF;
  checks := checks + 1;
  -- 2. tax_settings changes: the columns follow, as before.
  UPDATE public.tenants SET tax_settings = tax_settings || '{"vatRate": 15, "enabled": false}'::jsonb WHERE id = t;
  IF (SELECT is_tax_enabled IS FALSE AND default_tax_rate = 15 FROM public.tenants WHERE id = t) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL columns did not follow';
  END IF;
  checks := checks + 1;
  -- 3. Other keys in tax_settings survive a change to the columns.
  UPDATE public.tenants SET tax_settings = tax_settings || '{"trn": "300000000000003"}'::jsonb WHERE id = t;
  UPDATE public.tenants SET default_tax_rate = 15, is_tax_enabled = true WHERE id = t;
  IF (SELECT tax_settings->>'trn' FROM public.tenants WHERE id = t) IS DISTINCT FROM '300000000000003' THEN RAISE EXCEPTION 'FAIL other keys lost'; END IF;
  checks := checks + 1;
  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
