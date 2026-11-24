-- Security audit batch 3 (20270112000002), after the push. Read-only.
select json_build_object(
  'sale_line_keys_ok', position(':line:'' || v_line_no' in pg_get_functiondef('public.create_pos_sale(uuid, jsonb, jsonb, jsonb)'::regprocedure)) > 0,
  'return_lines_once_ok', position('count(DISTINCT e->>''order_item_id'')' in pg_get_functiondef('public.process_sales_return(uuid, uuid, uuid, jsonb, text, payment_method)'::regprocedure)) > 0,
  'new_order_fabric_cap_ok', position('> 15 * v_qty' in pg_get_functiondef('public.create_tailoring_order(uuid, jsonb, jsonb)'::regprocedure)) > 0,
  'old_order_fabric_cap_ok', position('GROUP BY 1' in pg_get_functiondef('public.update_order_status_with_fabric(uuid, text, text, jsonb, text, uuid, text)'::regprocedure)) > 0,
  'manual_invoice_needs_tax_ok', position('app_has_permission(''reports.tax'')' in pg_get_functiondef('public.issue_tax_invoice_for_order(uuid, uuid)'::regprocedure)) > 0,
  'one_referral_reward_ok', position('S-23' in pg_get_functiondef('public.confirm_referral(uuid)'::regprocedure)) > 0
                         and position('S-23' in pg_get_functiondef('public.confirm_partner_referral(uuid)'::regprocedure)) > 0,
  'delete_leaves_nothing_ok', position('DELETE FROM public.tailor_requests' in pg_get_functiondef('public.permanently_delete_tenant(uuid, text)'::regprocedure)) > 0,
  'shops_with_both_referrals', (select count(*) from public.referrals r join public.partner_referrals p on p.referred_tenant_id = r.referred_tenant_id),
  'anon_definer_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'))
) as result;
