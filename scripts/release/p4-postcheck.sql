-- seen-readiness-fixes-task.md P4 release: read-only check AFTER the push. Every *_ok must be true.
--   npx supabase db query --linked --project-ref bvvhxjrlwphvrmneieuk --file scripts/release/p4-postcheck.sql
SELECT json_build_object(
  'migrations_ok', (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '20270105%') = 8,
  'functions_ok', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname IN ('update_tailoring_order','app_auto_issue_tax_invoice','guard_order_delete',
                      'guard_customer_delete','sync_invoice_paid_from_order','ship_stock_transfer','receive_stock_transfer','reject_stock_transfer',
                      'approve_stock_take_draft','issue_measurements_link','revoke_measurements_link','save_public_measurements',
                      'save_whatsapp_settings','continue_with_fabric_shortage')) = 14,
  'triggers_ok', (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
                   ('orders_auto_tax_invoice','orders_guard_delete','customers_guard_delete','orders_sync_invoice_paid')) = 4,
  'old_transfer_fns_closed_ok', NOT has_function_privilege('authenticated', 'public.transfer_ship_item(text, uuid, uuid, uuid, numeric)', 'EXECUTE'),
  'server_only_fns_ok', NOT has_function_privilege('authenticated', 'public.save_public_measurements(uuid, jsonb)', 'EXECUTE')
                        AND NOT has_function_privilege('anon', 'public.save_public_measurements(uuid, jsonb)', 'EXECUTE'),
  'links_have_expiry_ok', NOT EXISTS (SELECT 1 FROM public.customers WHERE measurements_token_expires_at IS NULL),
  'anon_definer_functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE'))
) AS postcheck;
