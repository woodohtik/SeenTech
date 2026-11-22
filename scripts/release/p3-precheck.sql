-- seen-readiness-fixes-task.md P3 release: read-only check BEFORE the push.
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/release/p3-precheck.sql
SELECT json_build_object(
  'last_migration', (SELECT max(version) FROM supabase_migrations.schema_migrations),
  'p1_p2_applied', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version BETWEEN '20270102000001' AND '20270103000001') = 6,
  'p3_already_applied', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270104000000'),
  'shops_with_counters', (SELECT count(*) FROM public.tenant_order_counters)
) AS precheck;
