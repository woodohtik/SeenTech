-- seen-readiness-fixes-task.md P3 release: read-only check AFTER the push. Every *_ok must be true.
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/release/p3-postcheck.sql
SELECT json_build_object(
  'migration_ok', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270104000000'),
  'table_ok', to_regclass('public.offline_number_blocks') IS NOT NULL,
  'reserve_for_signed_in_only_ok', has_function_privilege('authenticated', 'public.reserve_offline_numbers(text, int)', 'EXECUTE')
                                   AND NOT has_function_privilege('anon', 'public.reserve_offline_numbers(text, int)', 'EXECUTE'),
  'sale_takes_offline_fields_ok', pg_get_functiondef('public.create_pos_sale(uuid,jsonb,jsonb,jsonb)'::regprocedure) LIKE '%offline_number%'
                                  AND pg_get_functiondef('public.create_pos_sale(uuid,jsonb,jsonb,jsonb)'::regprocedure) LIKE '%sold_at%',
  'sale_still_for_signed_in_only_ok', has_function_privilege('authenticated', 'public.create_pos_sale(uuid,jsonb,jsonb,jsonb)', 'EXECUTE')
                                      AND NOT has_function_privilege('anon', 'public.create_pos_sale(uuid,jsonb,jsonb,jsonb)', 'EXECUTE'),
  'anon_definer_functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE'))
) AS postcheck;
