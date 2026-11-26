-- seen-merchant-trial-test-2026-11-26.md, phase 3, after pushing 20270119000000,
-- 20270120000000, 20270120000001 and 20270121000000. Read-only. Every *_ok true.
select json_build_object(
  -- 20270119: each shop numbers its own purchase orders.
  'counters_table_ok', to_regclass('public.document_counters') is not null,
  'counters_closed_ok', not has_table_privilege('authenticated', 'public.document_counters', 'SELECT'),
  'next_number_not_callable_ok', not has_function_privilege('authenticated', 'public.next_document_number(uuid, text)'::regprocedure, 'EXECUTE'),
  'po_numbered_by_server_ok', position('next_document_number' in pg_get_functiondef(
      'public.create_purchase_order(uuid, jsonb, jsonb)'::regprocedure)) > 0,

  -- 20270120 + 20270120000001: an opening balance, once, with a permission check.
  'opening_fn_ok', to_regprocedure('public.record_opening_balance(uuid, uuid, numeric)') is not null,
  'opening_fn_checks_permission_ok', position('inventory.create' in pg_get_functiondef(
      'public.record_opening_balance(uuid, uuid, numeric)'::regprocedure)) > 0,
  'opening_fn_not_anon_ok', not has_function_privilege('anon', 'public.record_opening_balance(uuid, uuid, numeric)'::regprocedure, 'EXECUTE'),
  'opening_type_ok', exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                             where t.typname = 'stock_movement_type' and e.enumlabel = 'opening_balance'),

  -- 20270121: more than one category per supplier.
  'supplier_extra_categories_ok', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'suppliers' and column_name = 'extra_categories'),

  'anon_definer_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'))
) as result;
