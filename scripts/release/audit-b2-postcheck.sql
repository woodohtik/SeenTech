-- Security audit batch 2 (20270112000001), after the push. Read-only.
select json_build_object(
  'withdrawal_needs_billing_ok', position('settings.billing' in pg_get_functiondef('public.request_withdrawal(uuid, numeric, text, text)'::regprocedure)) > 0,
  'purchase_confirm_needs_suppliers_ok', position('suppliers.manage' in pg_get_functiondef('public.confirm_purchase_order(uuid)'::regprocedure)) > 0,
  'plan_limit_on_reopen_ok', exists (select 1 from pg_trigger where tgname = 'enforce_orders_plan_limit_reopen' and not tgisinternal),
  'log_actor_triggers_ok', (select count(*) from pg_trigger where tgname in ('audit_logs_actor_is_caller', 'security_logs_actor_is_caller') and not tgisinternal) = 2,
  'tenant_only_writes_left', (select json_agg(tablename || '.' || policyname) from pg_policies where schemaname = 'public'
       and tablename in ('branches','purchase_orders','purchase_order_items','stock_transfers','stock_transfer_items','sales_return_items','shifts','shift_entries')
       and cmd in ('INSERT','UPDATE','DELETE') and coalesce(with_check, qual) not ilike '%app_has_permission%'),
  'anon_definer_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'))
) as result;
