-- Security audit batch 1 (20270112000000), after the push. Read-only.
select json_build_object(
  'staff_guard_ok', exists (select 1 from pg_trigger where tgname = 'staff_identity_guard_trigger' and not tgisinternal),
  'users_guard_ok', exists (select 1 from pg_trigger where tgname = 'users_self_write_guard_trigger' and not tgisinternal),
  'role_follows_current_shop_ok', position('tenant_id = v_tenant' in pg_get_functiondef('public.app_current_role()'::regprocedure)) > 0,
  'staff_follows_current_shop_ok', position('tenant_id = v_tenant' in pg_get_functiondef('public.app_current_staff_id()'::regprocedure)) > 0,
  'role_id_own_shop_ok', position('tenant_id = v_staff.tenant_id OR tenant_id IS NULL' in pg_get_functiondef('public.app_effective_permissions(uuid)'::regprocedure)) > 0,
  'pin_list_coalesce_ok', position('coalesce(app_is_super_admin()' in pg_get_functiondef('public.staff_ids_with_pin_set(uuid)'::regprocedure)) > 0,
  'guards_not_callable_ok', not has_function_privilege('anon', 'public.staff_identity_guard()', 'EXECUTE') and not has_function_privilege('authenticated', 'public.users_self_write_guard()', 'EXECUTE'),
  'anon_definer_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'))
) as result;
