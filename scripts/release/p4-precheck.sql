-- seen-readiness-fixes-task.md P4 release: read-only check BEFORE the push.
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/release/p4-precheck.sql
SELECT json_build_object(
  'last_migration', (SELECT max(version) FROM supabase_migrations.schema_migrations),
  'p3_applied', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270104000000'),
  'p4_already_applied', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '20270105%'),
  'transfers_in_flight', (SELECT count(*) FROM public.stock_transfers WHERE status IN ('pending', 'in_transit')),
  'draft_stock_counts', (SELECT count(*) FROM public.inventory_adjustments WHERE status::text = 'Draft'),
  'customers_with_links', (SELECT count(*) FROM public.customers)
) AS precheck;
