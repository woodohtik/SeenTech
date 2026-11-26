-- seen-merchant-trial-test-2026-11-26.md, after pushing 20270116000000,
-- 20270117000000 and 20270118000000. Read-only. Every *_ok must be true.
select json_build_object(
  -- 20270116: a PIN-only tailor; everyone else keeps an email.
  'staff_email_nullable_ok', (select is_nullable = 'YES' from information_schema.columns
                              where table_schema = 'public' and table_name = 'staff' and column_name = 'email'),
  'staff_email_rule_ok', exists (select 1 from pg_constraint where conname = 'staff_email_required_unless_tailor'
                                 and conrelid = 'public.staff'::regclass),
  'staff_without_email_not_tailor', (select count(*) from public.staff where email is null and role::text <> 'tailor'),

  -- 20270117: garment components, rules on, the new function guarded.
  'garment_components_table_ok', to_regclass('public.garment_components') is not null,
  'garment_components_rls_ok', (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.garment_components'::regclass),
  'garment_components_policies', (select count(*) from pg_policy where polrelid = 'public.garment_components'::regclass),
  'orders_components_columns_ok', (select count(*) = 2 from information_schema.columns
                                   where table_schema = 'public' and table_name = 'orders'
                                     and column_name in ('components_taken_at', 'components_taken')),
  'components_fn_checks_permission_ok', position('orders.update_status' in pg_get_functiondef(
      'public.update_order_status_with_components(uuid, text, text, jsonb, jsonb, text, uuid, text)'::regprocedure)) > 0,
  'components_fn_not_anon_ok', not has_function_privilege('anon',
      'public.update_order_status_with_components(uuid, text, text, jsonb, jsonb, text, uuid, text)'::regprocedure, 'EXECUTE'),
  'fabric_fn_unchanged_ok', position('fabric_taken_meters' in pg_get_functiondef(
      'public.update_order_status_with_fabric(uuid, text, text, jsonb, text, uuid, text)'::regprocedure)) > 0,

  -- 20270118: the "order ready" template is a known name; permission check kept.
  'order_ready_template_ok', position('''order_ready''' in pg_get_functiondef('public.save_whatsapp_templates(boolean, jsonb)'::regprocedure)) > 0,
  'templates_fn_checks_permission_ok', position('settings.whatsapp' in pg_get_functiondef('public.save_whatsapp_templates(boolean, jsonb)'::regprocedure)) > 0,

  'anon_definer_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                             where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'))
) as result;
