-- seen-readiness-fixes-task.md P6 batch 2 (support consent, money): read-only check BEFORE the push.
-- Every *_ok must be true; the counts say what the release will touch.
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/release/p6b-precheck.sql
SELECT json_build_object(
  -- 20270108000002 uses ALTER COLUMN ... SET EXPRESSION: PostgreSQL 17 or later.
  'postgres_17_ok', current_setting('server_version_num')::int >= 170000,
  'postgres_version', current_setting('server_version'),
  'not_yet_applied_ok', (SELECT count(*) FROM supabase_migrations.schema_migrations
                          WHERE version IN ('20270107000002','20270108000000','20270108000001','20270108000002','20270108000003','20270108000004','20270108000005')) = 0,
  'earlier_batches_applied_ok', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '20270106%') = 5
                                AND (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20270107000000','20270107000001')) = 2,
  'helpers_ok', (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
                  AND p.proname IN ('app_actor_staff_id','app_current_role','app_is_tenant_owner','app_has_permission','end_impersonation_session',
                                    'process_sales_return','get_tenant_financial_summary','dashboard_order_rows','create_pos_sale',
                                    'increment_supplier_balance','calculate_order_tailor_commission','tenants_tax_settings_sync',
                                    'check_sales_return_total','sync_tax_invoice_paid_amount','tax_settings_from_legacy')) = 15,
  'signatures_ok', to_regprocedure('public.increment_supplier_balance(uuid, numeric, uuid)') IS NOT NULL
                   AND to_regprocedure('public.sync_tax_invoice_paid_amount(uuid, numeric)') IS NOT NULL
                   AND to_regprocedure('public.dashboard_order_rows(uuid, uuid)') IS NOT NULL
                   AND to_regprocedure('public.get_tenant_financial_summary(uuid, date, date, uuid, uuid)') IS NOT NULL,
  'remaining_is_generated_ok', (SELECT is_generated = 'ALWAYS' AND generation_expression = '(total_amount - paid_amount)'
                                  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'remaining_amount'),
  'new_columns_free_ok', NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                           AND ((table_name = 'orders' AND column_name IN ('credited_amount', 'commission_at'))
                             OR (table_name = 'shift_entries' AND column_name = 'source')
                             OR (table_name = 'support_access_requests' AND column_name IN ('responded_at', 'responded_by')))),
  'new_functions_free_ok', NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
                           AND p.proname IN ('record_cash_movement','record_supplier_transaction','start_support_session',
                                             'respond_support_access_request','app_is_shop_manager','orders_guard_credited_amount','shift_entries_set_source')),
  'entry_types_ok', (SELECT array_agg(enumlabel::text ORDER BY enumlabel) FROM pg_enum WHERE enumtypid = 'public.shift_entry_type'::regtype) = ARRAY['deposit','payout'],
  'stock_operations_ok', to_regclass('public.stock_operations') IS NOT NULL AND to_regclass('public.support_sessions') IS NOT NULL,
  -- What the release touches.
  'open_shifts_now', (SELECT count(*) FROM public.shifts WHERE status = 'open'),
  'shift_entries_by_kind', (SELECT json_build_object(
        'supplier_payment', count(*) FILTER (WHERE reason LIKE 'سند صرف رقم %'),
        'order_refund', count(*) FILTER (WHERE reason LIKE 'رد مبلغ طلب ملغى #%'),
        'manual', count(*) FILTER (WHERE reason NOT LIKE 'سند صرف رقم %' AND reason NOT LIKE 'رد مبلغ طلب ملغى #%' OR reason IS NULL)) FROM public.shift_entries),
  'orders_with_commission_to_date', (SELECT count(*) FROM public.orders WHERE calculated_commission IS NOT NULL),
  'sales_returns', (SELECT count(*) FROM public.sales_returns),
  'pending_support_requests', (SELECT count(*) FROM public.support_access_requests WHERE status = 'pending'),
  'open_support_sessions', (SELECT count(*) FROM public.support_sessions WHERE ended_at IS NULL),
  'old_support_requests_copy', (SELECT count(*) FROM public.saas_settings WHERE key = 'support_access_requests'),
  'shops_whose_tax_columns_and_settings_disagree', (SELECT count(*) FROM public.tenants
        WHERE jsonb_typeof(tax_settings) = 'object' AND (tax_settings ? 'enabled')
          AND (tax_settings->>'enabled')::boolean IS DISTINCT FROM is_tax_enabled)
) AS precheck;
