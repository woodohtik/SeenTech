-- 20270111000000 (saas_users_read_own_row), before the push. Read-only.
select json_build_object(
  'policy_absent_ok', not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saas_users' and policyname = 'saas_users_read_own_row'),
  'rls_on_ok', (select relrowsecurity from pg_class where oid = 'public.saas_users'::regclass),
  'super_admins', (select count(*) from public.saas_users where role = 'super_admin' and is_active),
  'super_admins_with_2fa', (select count(*) from public.saas_users where role = 'super_admin' and is_active and mfa_enabled is true)
) as result;
