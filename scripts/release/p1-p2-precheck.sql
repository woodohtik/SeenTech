-- seen-readiness-fixes-task.md P1+P2 release: read-only check BEFORE the push.
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/release/p1-p2-precheck.sql
SELECT json_build_object(
  'last_migration', (SELECT max(version) FROM supabase_migrations.schema_migrations),
  'p0_applied', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270102000000'),
  'p1_p2_already_applied', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version >= '20270102000001'),
  'orders_rate_as_percent', (SELECT count(*) FROM public.orders WHERE tax_rate > 1),
  'invoices_rate_as_percent', (SELECT count(*) FROM public.tax_invoices WHERE tax_rate > 1),
  'open_shifts', (SELECT count(*) FROM public.shifts WHERE status = 'open'),
  'production_zatca_certificates', (SELECT count(*) FROM public.zatca_credentials WHERE csid_type = 'production'),
  'invoices_last_24h', (SELECT count(*) FROM public.tax_invoices WHERE created_at > now() - interval '24 hours'),
  'credit_notes', (SELECT count(*) FROM public.sales_returns)
) AS precheck;
