-- seen-readiness-fixes-task.md P1+P2 release: read-only check AFTER the push. Every *_ok must be true.
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/release/p1-p2-postcheck.sql
SELECT json_build_object(
  'migrations_ok', (SELECT count(*) FROM supabase_migrations.schema_migrations
                     WHERE version IN ('20270102000001','20270102000002','20270102000003','20270102000004','20270103000000','20270103000001')) = 6,
  'functions_ok', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname IN ('app_tax_document','cancel_order','zatca_claim_submissions',
                      'zatca_finish_submission','zatca_signing_begin','zatca_signing_store','zatca_signing_end','zatca_stamp_document')) = 8,
  'triggers_ok', (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
                   ('tax_invoices_zatca_enqueue','sales_returns_zatca_enqueue','tax_invoices_zatca_stamp','sales_returns_zatca_stamp','trg_sales_returns_immutable')) = 5,
  'rates_are_fractions_ok', (SELECT count(*) FROM public.orders WHERE tax_rate > 1) + (SELECT count(*) FROM public.tax_invoices WHERE tax_rate > 1) = 0,
  'browser_cannot_run_worker_ok', NOT has_function_privilege('authenticated', 'public.zatca_claim_submissions(int)', 'EXECUTE')
                                  AND NOT has_function_privilege('anon', 'public.zatca_signing_begin(uuid, timestamptz, int)', 'EXECUTE'),
  'browser_can_cancel_ok', has_function_privilege('authenticated', 'public.cancel_order(uuid, uuid, text)', 'EXECUTE')
                           AND NOT has_function_privilege('anon', 'public.cancel_order(uuid, uuid, text)', 'EXECUTE'),
  'first_pih_ok', public.zatca_first_pih() = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
  'queued_documents', (SELECT count(*) FROM public.zatca_submissions),
  'anon_definer_functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE'))
) AS postcheck;
