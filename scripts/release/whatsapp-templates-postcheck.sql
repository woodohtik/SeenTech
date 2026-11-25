-- 20270114000000_whatsapp_templates.sql, after the push. Read-only.
select json_build_object(
  'templates_fn_ok', exists (select 1 from pg_proc where proname = 'save_whatsapp_templates'),
  'templates_fn_checks_permission_ok', position('settings.whatsapp' in pg_get_functiondef('public.save_whatsapp_templates(boolean, jsonb)'::regprocedure)) > 0,
  'old_fn_keeps_templates_ok', position('whatsapp_settings, ''{}''::jsonb) INTO v_settings' in pg_get_functiondef('public.save_whatsapp_settings(boolean, text)'::regprocedure)) > 0,
  'old_templates_copied_ok', not exists (select 1 from public.tenants where coalesce(btrim(whatsapp_settings ->> 'template'), '') <> '' and (whatsapp_settings -> 'templates') is null),
  'shops_with_own_templates', (select count(*) from public.tenants where (whatsapp_settings -> 'templates') is not null),
  'anon_definer_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'))
) as result;
