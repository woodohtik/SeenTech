-- seen-readiness-fixes-task.md P5 release: read-only check BEFORE the push. Every *_ok must be true;
-- the counts say what the release will touch.
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/release/p5-precheck.sql
SELECT json_build_object(
  'not_yet_applied_ok', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '20270106%') = 0,
  'p4_applied_ok', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '20270105%') = 8,
  'helpers_ok', (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
                  AND p.proname IN ('app_current_uid','app_is_super_admin','app_has_permission','app_current_tenant_id',
                                    'trial_lock_sweep','trial_purge_sweep','approve_subscription_request',
                                    'create_subscription_request','permanently_delete_tenant')) = 9,
  'request_fn_signature_ok', to_regprocedure('public.create_subscription_request(uuid, text, text, text, text, text, text, text, text)') IS NOT NULL,
  'tables_ok', to_regclass('public.saas_security_logs') IS NOT NULL AND to_regclass('public.subscription_requests') IS NOT NULL
               AND to_regclass('public.sales_return_items') IS NOT NULL AND to_regclass('public.shifts') IS NOT NULL,
  'new_names_free_ok', to_regclass('public.saas_subscription_payments') IS NULL AND to_regclass('public.tenant_data_exports') IS NULL
                       AND to_regclass('public.tax_document_archive') IS NULL
                       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                                         AND ((table_name = 'plans' AND column_name = 'billing_period')
                                           OR (table_name = 'users' AND column_name IN ('terms_version','privacy_version','legal_accepted_at')))),
  'approved_requests_to_copy', (SELECT count(*) FROM public.subscription_requests r WHERE r.status = 'approved'
                                  AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = r.tenant_id)),
  'old_subscription_rows_in_sales_payments', (SELECT count(*) FROM public.payments WHERE notes LIKE 'سداد وتفعيل اشتراك%'),
  'pending_requests', (SELECT count(*) FROM public.subscription_requests WHERE status = 'pending'),
  'paid_shops_regaining_access_in_grace', (SELECT count(*) FROM public.tenants WHERE subscription_end_date BETWEEN now() - interval '3 days' AND now()),
  'locked_trials_past_purge', (SELECT count(*) FROM public.tenants WHERE subscription_status = 'locked' AND is_trial AND purge_at < now()),
  'trashed_shops', (SELECT count(*) FROM public.tenants WHERE trashed_at IS NOT NULL),
  'plans', (SELECT json_agg(json_build_object('id', id, 'price', price) ORDER BY id) FROM public.plans)
) AS precheck;
