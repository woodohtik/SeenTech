-- seen-readiness-fixes-task.md P6 security batch 1: read-only check AFTER the push. Every *_ok must be true.
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/release/p6a-postcheck.sql
SELECT json_build_object(
  'migrations_ok', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20270107000000', '20270107000001')) = 2,
  'uploads_policy_ok', NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'uploads_public_read')
                       AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'uploads_scoped_read'),
  'lookup_counter_ok', to_regprocedure('public.increment_order_lookup_failure(text)') IS NOT NULL
                       AND NOT has_function_privilege('anon', 'public.increment_order_lookup_failure(text)', 'EXECUTE')
                       AND NOT has_function_privilege('authenticated', 'public.increment_order_lookup_failure(text)', 'EXECUTE'),
  'anon_definer_functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE'))
) AS postcheck;
