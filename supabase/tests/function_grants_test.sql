-- seen-readiness-fixes-task.md P0 (SECURITY-01..06): who may execute which
-- function. pgTAP -- runs in CI on a fresh database built from the migrations
-- (20261123010000_baseline_role_grants included, so it proves the later
-- revoke wins), and on staging with
--   npx supabase db query --linked --file supabase/tests/function_grants_test.sql
BEGIN;
SELECT plan(10);

-- 1. No SECURITY DEFINER function in public is executable by anon, except the
--    identity helpers RLS policies call for every request (they return NULL
--    without a login) and has_used_trial (public on purpose).
SELECT is(
  (SELECT coalesce(array_agg(p.proname::text ORDER BY p.proname), '{}')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname NOT IN ('app_acting_staff_id', 'app_current_role', 'app_current_staff_id',
                            'app_current_tenant_id', 'app_is_super_admin', 'has_used_trial')),
  '{}'::text[],
  'anon executes no privileged function outside the allow-list');

-- 2. The account-takeover function is gone.
SELECT ok(to_regprocedure('public.remap_user_uid(text,text)') IS NULL, 'remap_user_uid does not exist');

-- 3-6. Internal functions are closed to signed-in users too.
SELECT ok(NOT has_function_privilege('authenticated', 'public.zatca_advance_chain_with_real_hash(uuid,uuid,text)', 'EXECUTE'),
          'the ZATCA chain is server-only');
SELECT ok(NOT has_function_privilege('authenticated', 'public.allocate_tenant_invoice_number(uuid)', 'EXECUTE'),
          'invoice numbers are allocated by the server functions only');
SELECT ok(NOT has_function_privilege('authenticated', 'public.assistant_get_sales_summary(uuid,date,date)', 'EXECUTE'),
          'assistant reports are server-only');
SELECT ok(NOT has_function_privilege('authenticated', 'public.reset_pin_verify_attempts(text)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.record_pin_verify_failure(text,integer,integer)', 'EXECUTE'),
          'the PIN lock cannot be reset or fed from the browser');

-- 7. New functions our migrations create (owner postgres) are not executable
--    by anon by default. (supabase_admin's own defaults belong to the platform.)
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
   WHERE n.nspname = 'public' AND d.defaclobjtype = 'f' AND d.defaclrole = 'postgres'::regrole::oid
     AND EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) a WHERE a.grantee = 'anon'::regrole::oid AND a.privilege_type = 'EXECUTE')),
  'no default EXECUTE for anon on new functions');

-- 8. The second lock: a signed-in client cannot pass another shop's id.
SET LOCAL session_replication_role = replica;
INSERT INTO public.tenants (id, name, owner_email, phone, status, is_test)
VALUES ('f0000000-0000-4000-8000-0000000000a1', 'grants A', 'grants-a@example.invalid', '0500000030', 'active', true);
INSERT INTO public.staff (id, tenant_id, uid, name, email, role, status, is_test)
VALUES ('f0000000-0000-4000-8000-0000000000b1', 'f0000000-0000-4000-8000-0000000000a1',
        'f0000000-0000-4000-8000-0000000000c1', 'grants owner', 'grants-owner@example.invalid', 'owner', 'active', true);
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.app_assert_tenant_access('f0000000-0000-4000-8000-0000000000ff') $$, '42501', NULL,
                 'a client passing another shop''s id is refused');
SELECT lives_ok($$ SELECT public.app_assert_tenant_access('f0000000-0000-4000-8000-0000000000a1') $$,
                'a client passing its own shop''s id passes');
RESET ROLE;

-- 10. A super admin with two-factor enabled counts only in an aal2 session.
SET LOCAL session_replication_role = replica;
INSERT INTO public.saas_users (uid, name, email, role, is_active, mfa_enabled)
VALUES ('f0000000-0000-4000-8000-0000000000d1', 'grants sa', 'grants-sa@example.invalid', 'super_admin', true, true);
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal1"}', true);
SELECT is(public.app_is_super_admin(), false, 'two-factor super admin with a password-only session is not a super admin');

SELECT * FROM finish();
ROLLBACK;
