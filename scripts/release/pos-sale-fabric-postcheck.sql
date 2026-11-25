-- 20270115000000_pos_sale_fabric_at_cutting.sql, after the push. Read-only.
select json_build_object(
  'taken_column_ok', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_items' and column_name = 'fabric_taken_meters'),
  'sale_marks_kind_ok', position('''pos_sale''' in pg_get_functiondef('public.create_pos_sale(uuid,jsonb,jsonb,jsonb)'::regprocedure)) > 0,
  'cutting_knows_pos_ok', position('fabric_line_mismatch' in pg_get_functiondef('public.update_order_status_with_fabric(uuid,text,text,jsonb,text,uuid,text)'::regprocedure)) > 0,
  'notes_kept_ok', position('''pos_sale''' in pg_get_functiondef('public.update_order_status(uuid,text,text,text,uuid,text)'::regprocedure)) > 0,
  'guard_ok', position('fabric_taken_meters' in pg_get_functiondef('public.guard_financial_columns()'::regprocedure)) > 0,
  'no_unmarked_sales_ok', not exists (select 1 from public.orders o where o.kind is null and exists (select 1 from public.order_items i where i.order_id = o.id)),
  'pos_sale_orders', (select count(*) from public.orders where kind = 'pos_sale'),
  'pos_lines_taken_at_sale', (select count(*) from public.order_items i join public.orders o on o.id = i.order_id where o.kind = 'pos_sale' and i.fabric_taken_meters is not null),
  'pos_orders_stamped', (select count(*) from public.orders where kind = 'pos_sale' and fabric_deducted_at is not null),
  'pos_cloth_orders_waiting_to_cut', (select count(*) from public.orders o where o.kind = 'pos_sale' and o.status < 'cutting'::order_status and exists (select 1 from public.order_items i where i.order_id = o.id and i.type = 'custom' and i.fabric_id is not null)),
  'anon_definer_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'))
) as result;
