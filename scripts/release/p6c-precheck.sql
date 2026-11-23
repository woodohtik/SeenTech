-- seen-readiness-fixes-task.md P6 batch 3 (platform): read-only check BEFORE the push.
-- Every *_ok must be true; the counts say what the release will touch.
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/release/p6c-precheck.sql
SELECT json_build_object(
  'not_yet_applied_ok', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20270109000000', '20270109000001')) = 0,
  'earlier_batch_applied_ok', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '20270108%') = 6,
  'helpers_ok', (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
                  AND p.proname IN ('enforce_orders_plan_limit','create_subscription_request','approve_subscription_request','reject_subscription_request',
                                    'trash_tenant','restore_tenant','permanently_delete_tenant','app_current_tenant_id','get_saas_revenue_report',
                                    'confirm_referral','confirm_partner_referral','assert_coupon_usable')) = 12,
  'referral_trigger_present_ok', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tenants_confirm_referral' AND NOT tgisinternal),
  'new_functions_free_ok', NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
                           AND p.proname IN ('admin_activate_plan','trg_confirm_referral_on_payment','saas_log_admin_action','saas_cron_health')),
  -- The unique index (a coupon once per shop) needs no existing duplicates.
  'no_coupon_duplicates_ok', NOT EXISTS (SELECT 1 FROM public.subscription_requests WHERE coupon_id IS NOT NULL AND status <> 'rejected'
                                          GROUP BY coupon_id, tenant_id HAVING count(*) > 1),
  'pg_cron_ok', to_regclass('cron.job') IS NOT NULL,
  -- What the release touches.
  'plans', (SELECT json_agg(json_build_object('id', id, 'price', price, 'max_orders', max_orders, 'billing_period', billing_period) ORDER BY id) FROM public.plans),
  'plans_with_a_limit_of_zero', (SELECT count(*) FROM public.plans WHERE max_orders = 0),
  'shops_with_two_pending_requests', (SELECT count(*) FROM (SELECT tenant_id FROM public.subscription_requests WHERE status = 'pending' GROUP BY 1 HAVING count(*) > 1) x),
  'pending_referrals', (SELECT count(*) FROM public.referrals WHERE status = 'pending'),
  'pending_referrals_of_shops_active_without_payment', (SELECT count(*) FROM public.referrals r JOIN public.tenants t ON t.id = r.referred_tenant_id
        WHERE r.status = 'pending' AND t.subscription_status = 'active'
          AND NOT EXISTS (SELECT 1 FROM public.saas_subscription_payments sp WHERE sp.tenant_id = t.id AND sp.amount > 0)),
  -- A trial past its end is closed at once after this release (the sweep closes it within 15 minutes anyway).
  'trials_past_their_end_still_open', (SELECT count(*) FROM public.tenants WHERE subscription_status = 'trial' AND trial_ends_at < now()),
  'cron_jobs', (SELECT count(*) FROM cron.job),
  'sales_total_the_report_showed', (SELECT COALESCE(SUM(total_amount), 0) FROM public.orders),
  'subscription_revenue_it_will_show', (SELECT COALESCE(SUM(amount), 0) FROM public.saas_subscription_payments)
) AS precheck;
