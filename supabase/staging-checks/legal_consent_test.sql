-- seen-readiness-fixes-task.md P5 (20270106000000). Staging, rolled back:
--   npx supabase db query --linked --file supabase/staging-checks/legal_consent_test.sql
DO $test$
DECLARE
  uid text := gen_random_uuid()::text;
  checks int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- 1. A sign-up row cannot carry an agreement of its own making.
  INSERT INTO public.users (id, email, display_name, terms_version, legal_accepted_at)
  VALUES (uid, 'legal-' || left(uid, 8) || '@example.invalid', 'x', 'forged', '2020-01-01');
  IF (SELECT terms_version FROM public.users WHERE id = uid) IS NOT NULL THEN RAISE EXCEPTION 'FAIL insert kept a forged agreement'; END IF;
  checks := checks + 1;
  -- 2. Nor can the browser write it afterwards.
  BEGIN
    UPDATE public.users SET legal_accepted_at = '2020-01-01' WHERE id = uid;
    RAISE EXCEPTION 'FAIL the browser wrote the agreement';
  EXCEPTION WHEN insufficient_privilege THEN checks := checks + 1;
  END;
  -- 3. The server records it, with the versions and now.
  PERFORM public.accept_legal_terms('2026-11-23-draft', '2026-11-23-draft');
  IF (SELECT terms_version FROM public.users WHERE id = uid) <> '2026-11-23-draft'
     OR (SELECT legal_accepted_at FROM public.users WHERE id = uid) < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'FAIL not recorded';
  END IF;
  checks := checks + 1;
  -- 4. The rest of the row still changes as before.
  UPDATE public.users SET display_name = 'y' WHERE id = uid;
  checks := checks + 1;
  RESET ROLE;
  RAISE EXCEPTION 'PASS: % checks', checks;
END
$test$;
