-- seen-stability-guardrails-task.md, phase 3.4: the checks inside the
-- sensitive functions are still there. A function redefined from an old
-- migration's copy loses them without any error (20261115070000 dropped
-- app_current_tenant_id's trash check that way); this fails instead.
--
--   CI:    supabase test db
--   Here:  npx tsx scripts/db/pgtap-linked.ts supabase/tests/function_guards_test.sql   (staging)
BEGIN;
SELECT plan(22);

CREATE TEMP TABLE _defs AS
SELECT p.proname AS name, string_agg(pg_get_functiondef(p.oid), E'\n') AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
 GROUP BY p.proname;

-- app_current_tenant_id: a shop that is inactive, trashed, locked, past its
-- trial or past its paid term (with grace) resolves to nothing.
SELECT ok((SELECT def FROM _defs WHERE name = 'app_current_tenant_id') ~ 't_status = ''inactive''', 'app_current_tenant_id: inactive shops');
SELECT ok((SELECT def FROM _defs WHERE name = 'app_current_tenant_id') ~ 't_trashed_at IS NOT NULL', 'app_current_tenant_id: trashed shops');
SELECT ok((SELECT def FROM _defs WHERE name = 'app_current_tenant_id') ~ '''locked''', 'app_current_tenant_id: locked shops');
SELECT ok((SELECT def FROM _defs WHERE name = 'app_current_tenant_id') ~ 't_trial_end < now\(\)', 'app_current_tenant_id: a trial past its end');
SELECT ok((SELECT def FROM _defs WHERE name = 'app_current_tenant_id') ~ 't_sub_end \+ interval', 'app_current_tenant_id: a paid term past its grace');

-- The writes that move money, stock or invoices ask for a permission.
SELECT ok((SELECT def FROM _defs WHERE name = n) ~ 'app_has_permission\(', n || ': asks for a permission')
  FROM unnest(ARRAY[
    'create_pos_sale', 'create_tailoring_order', 'update_order_status', 'update_order_status_with_fabric',
    'record_order_payment', 'open_shift', 'close_shift', 'process_sales_return', 'cancel_order',
    'apply_stock_movement', 'save_whatsapp_templates'
  ]) AS n;

-- create_pos_sale keeps the ZATCA chain, its stock-conflict handling and its tracking token.
SELECT ok((SELECT def FROM _defs WHERE name = 'create_pos_sale') ~ 'zatca_invoice_chain_state', 'create_pos_sale: the ZATCA hash chain (PIH)');
SELECT ok((SELECT def FROM _defs WHERE name = 'create_pos_sale') ~ 'previous_invoice_hash', 'create_pos_sale: each invoice names the one before');
SELECT ok((SELECT def FROM _defs WHERE name = 'create_pos_sale') ~ 'SQLSTATE ''23514''', 'create_pos_sale: a stock conflict marks the line, not the sale');
SELECT ok((SELECT def FROM _defs WHERE name = 'create_pos_sale') ~ 'RETURNING tracking_token', 'create_pos_sale: the tracking token reaches the customer');

-- update_order_status_with_fabric: a POS sale's cloth moves by the difference only.
SELECT ok((SELECT def FROM _defs WHERE name = 'update_order_status_with_fabric') ~ 'fabric_taken_meters', 'update_order_status_with_fabric: cloth taken at the sale is not taken again');
SELECT ok((SELECT def FROM _defs WHERE name = 'update_order_status_with_fabric') ~ 'stock_operations', 'update_order_status_with_fabric: the same request moves nothing twice');

SELECT * FROM finish();
ROLLBACK;
