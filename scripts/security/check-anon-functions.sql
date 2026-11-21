-- Read-only. Privileged (SECURITY DEFINER) functions an anonymous visitor can run.
-- After 20270102000000 only these six may appear: app_acting_staff_id,
-- app_current_role, app_current_staff_id, app_current_tenant_id,
-- app_is_super_admin, has_used_trial.
SELECT json_build_object(
  'count', count(*),
  'functions', json_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' ORDER BY p.proname),
  'remap_user_uid_exists', to_regprocedure('public.remap_user_uid(text,text)') IS NOT NULL,
  'latest_migration', (SELECT max(version) FROM supabase_migrations.schema_migrations)
) AS r
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE');
