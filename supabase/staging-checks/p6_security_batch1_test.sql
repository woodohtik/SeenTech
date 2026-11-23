-- seen-readiness-fixes-task.md P6 (20270107000000, 20270107000001). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/p6_security_batch1_test.sql
DO $test$
DECLARE
  a record;
  b record;
  n int;
  checks int := 0;
BEGIN
  SELECT t.id, t.owner_uid INTO a FROM public.tenants t WHERE t.owner_uid IS NOT NULL AND t.trashed_at IS NULL
     AND coalesce(t.subscription_status, '') NOT IN ('locked', 'purge_pending') AND t.status <> 'inactive' ORDER BY t.created_at LIMIT 1;
  SELECT t.id, t.owner_uid INTO b FROM public.tenants t WHERE t.owner_uid IS NOT NULL AND t.id <> a.id ORDER BY t.created_at LIMIT 1;
  IF a.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'SKIP: need two shops'; END IF;
  UPDATE public.tenants SET subscription_end_date = NULL WHERE id = a.id;
  INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES
    ('uploads', 'tenants/' || a.id || '/chk-a.jpg', a.owner_uid::text),
    ('uploads', 'tenants/' || b.id || '/chk-b.jpg', b.owner_uid::text);

  -- 1. Nobody signed out lists the bucket.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'uploads';
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL anon lists % files', n; END IF;
  checks := checks + 1;

  -- 2. A shop sees its own files and not another's.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a.owner_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a.owner_uid::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'uploads' AND name = 'tenants/' || a.id || '/chk-a.jpg';
  IF n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'FAIL own file not visible'; END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'uploads' AND name LIKE 'tenants/' || b.id || '/%';
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL another shop''s files visible'; END IF;
  checks := checks + 2;

  -- 3. The order-number counter: an hour's window, closed to the browser.
  IF public.increment_order_lookup_failure('987654') <> 1 OR public.increment_order_lookup_failure('987654') <> 2 THEN RAISE EXCEPTION 'FAIL counter'; END IF;
  IF (SELECT reset_at FROM public.tracking_attempts WHERE ip = 'order:987654') < now() + interval '59 minutes' THEN RAISE EXCEPTION 'FAIL window'; END IF;
  checks := checks + 1;
  IF has_function_privilege('anon', 'public.increment_order_lookup_failure(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.increment_order_lookup_failure(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL counter open to the browser';
  END IF;
  checks := checks + 1;
  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
