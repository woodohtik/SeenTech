-- seen-readiness-fixes-task.md P5 release: read-only check AFTER the push. Every *_ok must be true.
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/release/p5-postcheck.sql
SELECT json_build_object(
  'migrations_ok', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '20270106%') = 5,
  'functions_ok', (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
                    AND p.proname IN ('accept_legal_terms','guard_users_legal_columns','admin_extend_trial','tenants_keep_created_at',
                                      'app_is_tenant_owner','export_tenant_data')) = 6,
  'tables_ok', to_regclass('public.saas_subscription_payments') IS NOT NULL AND to_regclass('public.tenant_data_exports') IS NOT NULL
               AND to_regclass('public.tax_document_archive') IS NOT NULL,
  'rls_ok', (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.saas_subscription_payments'::regclass,
              'public.tenant_data_exports'::regclass, 'public.tax_document_archive'::regclass)),
  'browser_cannot_write_ledgers_ok', NOT has_table_privilege('authenticated', 'public.saas_subscription_payments', 'INSERT')
              AND NOT has_table_privilege('authenticated', 'public.tenant_data_exports', 'INSERT')
              AND NOT has_table_privilege('authenticated', 'public.tax_document_archive', 'INSERT')
              AND NOT has_table_privilege('authenticated', 'public.tax_document_archive', 'DELETE'),
  'triggers_ok', (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('users_guard_legal_columns','tenants_keep_created_at')) = 2,
  'anon_closed_ok', NOT has_function_privilege('anon', 'public.accept_legal_terms(text, text)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.admin_extend_trial(uuid, integer)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.export_tenant_data(uuid)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.app_is_tenant_owner(uuid)', 'EXECUTE'),
  'approval_uses_period_and_ledger_ok', (SELECT bool_and(prosrc LIKE '%billing_period%' AND prosrc LIKE '%saas_subscription_payments%'
              AND prosrc NOT LIKE '%INSERT INTO public.payments%') FROM pg_proc WHERE proname = 'approve_subscription_request'),
  'locked_owner_can_renew_ok', (SELECT bool_and(prosrc LIKE '%app_is_tenant_owner%') FROM pg_proc WHERE proname = 'create_subscription_request'),
  'grace_ok', (SELECT bool_and(prosrc LIKE '%3 days%') FROM pg_proc WHERE proname IN ('trial_lock_sweep', 'app_current_tenant_id')),
  'purge_safe_ok', (SELECT bool_and(prosrc LIKE '%status = $$pending$$%' OR prosrc LIKE '%subscription_requests sr%')
              FROM pg_proc WHERE proname = 'trial_purge_sweep')
              AND (SELECT bool_and(prosrc LIKE '%public.tax_invoices x%' AND prosrc LIKE '%EXCEPTION WHEN OTHERS%') FROM pg_proc WHERE proname = 'trial_purge_sweep'),
  'delete_needs_export_ok', (SELECT bool_and(prosrc LIKE '%tenant_data_exports%' AND prosrc LIKE '%tax_document_archive%') FROM pg_proc WHERE proname = 'permanently_delete_tenant'),
  'ledger_backfilled_ok', (SELECT count(*) FROM public.saas_subscription_payments)
              >= (SELECT count(*) FROM public.subscription_requests r WHERE r.status = 'approved' AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = r.tenant_id)),
  'plans_have_period_ok', NOT EXISTS (SELECT 1 FROM public.plans WHERE billing_period IS NULL),
  'anon_definer_functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE'))
) AS postcheck;
