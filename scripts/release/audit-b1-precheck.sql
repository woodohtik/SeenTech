-- Security audit batch 1 (20270112000000), before the push. Read-only.
select json_build_object(
  'not_applied_yet_ok', not exists (select 1 from pg_trigger where tgname = 'staff_identity_guard_trigger'),
  'staff_rows_with_foreign_role', (select count(*) from public.staff s join public.roles r on r.id = s.role_id where r.tenant_id is not null and r.tenant_id <> s.tenant_id),
  'users_with_multiple_active_shops', (select count(*) from (select uid from public.staff where status = 'active' and uid is not null group by uid having count(distinct tenant_id) > 1) x),
  'anon_definer_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE'))
) as result;
