-- seen-readiness-fixes-task.md P6 batch 3 (platform): read-only check AFTER the push. Every *_ok must be true.
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/release/p6c-postcheck.sql
SELECT json_build_object(
  'migrations_ok', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20270109000000', '20270109000001')) = 2,
  'functions_ok', (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
                    AND p.proname IN ('admin_activate_plan','trg_confirm_referral_on_payment','saas_log_admin_action','saas_cron_health')) = 4,
  'base_plans_ok', (SELECT count(*) FROM public.plans WHERE id IN ('free', 'basic')) = 2,
  'limit_zero_is_no_limit_ok', (SELECT bool_and(prosrc LIKE '%v_max_orders <= 0%') FROM pg_proc WHERE proname = 'enforce_orders_plan_limit'),
  'one_pending_request_ok', (SELECT bool_and(prosrc LIKE '%sr.status = ''pending''%' AND prosrc LIKE '%sr.coupon_id = v_coupon.id%') FROM pg_proc WHERE proname = 'create_subscription_request'),
  'coupon_index_ok', to_regclass('public.subscription_requests_coupon_once_per_shop') IS NOT NULL,
  'referral_follows_payment_ok', NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tenants_confirm_referral' AND NOT tgisinternal)
              AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'saas_subscription_payments_confirm_referral' AND NOT tgisinternal),
  'admin_only_ok', NOT has_function_privilege('anon', 'public.admin_activate_plan(uuid, text, numeric, text, text)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.saas_cron_health()', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.saas_log_admin_action(text, text)', 'EXECUTE')
              AND NOT has_function_privilege('authenticated', 'public.saas_log_admin_action(text, text)', 'EXECUTE'),
  'actions_log_themselves_ok', (SELECT count(*) FROM pg_proc WHERE proname IN ('trash_tenant','restore_tenant','permanently_delete_tenant','approve_subscription_request','reject_subscription_request')
                                  AND prosrc LIKE '%saas_log_admin_action%') = 5,
  'revenue_is_seens_ok', (SELECT bool_and(prosrc LIKE '%saas_subscription_payments%' AND prosrc LIKE '%paying_shops%' AND prosrc NOT LIKE '%FROM orders%') FROM pg_proc WHERE proname = 'get_saas_revenue_report'),
  'trial_second_line_ok', (SELECT bool_and(prosrc LIKE '%t_trial_end < now()%' AND prosrc LIKE '%3 days%') FROM pg_proc WHERE proname = 'app_current_tenant_id'),
  'cron_readable_ok', (public.saas_cron_health()->>'pg_cron')::boolean IS TRUE AND jsonb_array_length(public.saas_cron_health()->'jobs') >= 1,
  'cron_jobs_last_runs', (SELECT json_agg(json_build_object('job', j->>'name', 'status', j->>'last_status', 'at', j->>'last_start')) FROM jsonb_array_elements(public.saas_cron_health()->'jobs') j),
  'anon_definer_functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE'))
) AS postcheck;
