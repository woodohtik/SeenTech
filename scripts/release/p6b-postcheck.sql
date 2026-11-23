-- seen-readiness-fixes-task.md P6 batch 2 (support consent, money): read-only check AFTER the push. Every *_ok must be true.
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/release/p6b-postcheck.sql
SELECT json_build_object(
  'migrations_ok', (SELECT count(*) FROM supabase_migrations.schema_migrations
                     WHERE version IN ('20270107000002','20270108000000','20270108000001','20270108000002','20270108000003','20270108000004','20270108000005')) = 7,
  'functions_ok', (SELECT count(DISTINCT p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
                    AND p.proname IN ('record_cash_movement','record_supplier_transaction','start_support_session','respond_support_access_request',
                                      'app_is_shop_manager','orders_guard_credited_amount','shift_entries_set_source')) = 7,
  'anon_closed_ok', NOT has_function_privilege('anon', 'public.record_cash_movement(uuid, uuid, text, numeric, text)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.record_supplier_transaction(uuid, uuid, text, numeric, numeric, text, timestamptz, text)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.start_support_session(uuid, uuid)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.respond_support_access_request(uuid, boolean)', 'EXECUTE')
              AND NOT has_function_privilege('anon', 'public.app_is_shop_manager(uuid)', 'EXECUTE'),
  -- Money.
  'drawer_history_server_only_ok', NOT has_table_privilege('authenticated', 'public.shift_entries', 'INSERT')
              AND NOT has_table_privilege('authenticated', 'public.shift_entries', 'UPDATE')
              AND NOT has_table_privilege('authenticated', 'public.shift_entries', 'DELETE'),
  'remaining_counts_credit_ok', (SELECT generation_expression LIKE '%credited_amount%' FROM information_schema.columns
                                   WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'remaining_amount'),
  'no_order_credited_yet_ok', NOT EXISTS (SELECT 1 FROM public.orders WHERE credited_amount <> 0)
              OR (SELECT bool_and(credited_amount >= 0 AND credited_amount <= total_amount + 0.01) FROM public.orders WHERE credited_amount <> 0),
  'every_entry_has_a_source_ok', NOT EXISTS (SELECT 1 FROM public.shift_entries WHERE source IS NULL),
  'commissions_dated_ok', NOT EXISTS (SELECT 1 FROM public.orders WHERE calculated_commission IS NOT NULL AND commission_at IS NULL),
  'triggers_ok', (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('orders_guard_credited_amount', 'shift_entries_set_source')) = 2,
  'sale_locks_its_operation_ok', (SELECT bool_and(prosrc LIKE '%pg_advisory_xact_lock(hashtext(v_op_key))%') FROM pg_proc WHERE proname = 'create_pos_sale'),
  'return_credits_the_order_ok', (SELECT bool_and(prosrc LIKE '%credited_amount = credited_amount + v_credited%') FROM pg_proc WHERE proname = 'process_sales_return'),
  'summary_ok', (SELECT bool_and(prosrc LIKE '%v_returns%' AND prosrc LIKE '%sh.branch_id = p_branch_id%' AND prosrc LIKE '%''manual''%')
                   FROM pg_proc WHERE proname = 'get_tenant_financial_summary'),
  'dashboard_ok', (SELECT bool_and(prosrc LIKE '%is_test%' AND prosrc LIKE '%cancelled%') FROM pg_proc WHERE proname = 'dashboard_order_rows'),
  'invoice_paid_from_order_ok', (SELECT bool_and(prosrc LIKE '%paid_amount = o.paid_amount%') FROM pg_proc WHERE proname = 'sync_tax_invoice_paid_amount'),
  'tax_sync_both_ways_ok', (SELECT bool_and(prosrc LIKE '%NEW.default_tax_rate IS DISTINCT FROM OLD.default_tax_rate%') FROM pg_proc WHERE proname = 'tenants_tax_settings_sync'),
  'supplier_key_claimed_first_ok', (SELECT bool_and(prosrc LIKE '%RETURNING true INTO v_claimed%') FROM pg_proc WHERE proname = 'increment_supplier_balance'),
  -- Support access.
  'support_policies_ok', (SELECT count(*) FROM pg_policies WHERE policyname IN ('support_access_requests_shop_read', 'support_sessions_shop_read')) = 2
              AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'support_sessions_insert_self'),
  'old_support_copy_gone_ok', NOT EXISTS (SELECT 1 FROM public.saas_settings WHERE key = 'support_access_requests'),
  'anon_definer_functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE'))
) AS postcheck;
