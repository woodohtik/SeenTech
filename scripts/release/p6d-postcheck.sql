-- seen-readiness-fixes-task.md P6 batch 4 (code health): read-only check AFTER the push. Every *_ok must be true.
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/release/p6d-postcheck.sql
SELECT json_build_object(
  'migrations_ok', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20270110000000') = 1,
  'trial_helpers_server_only_ok', NOT has_function_privilege('anon', 'public.has_used_trial(text, text)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.has_used_trial(text, text)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.start_tenant_trial(uuid, integer)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.start_tenant_trial(uuid, integer)', 'EXECUTE')
              AND has_function_privilege('service_role', 'public.has_used_trial(text, text)', 'EXECUTE'),
  -- 5 from here on: the identity helpers row-level security needs (app_current_role, app_acting_staff_id,
  -- app_current_staff_id, app_is_super_admin, app_current_tenant_id).
  'anon_definer_functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  'anon_definer_functions_ok', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE')) = 5
) AS postcheck;
