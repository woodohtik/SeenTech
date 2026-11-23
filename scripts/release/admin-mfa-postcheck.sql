-- 20270111000000 (saas_users_read_own_row), after the push. Read-only.
select json_build_object(
  'policy_ok', exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saas_users'
                        and policyname = 'saas_users_read_own_row' and cmd = 'SELECT' and roles = '{authenticated}'),
  'own_row_only_ok', (select qual from pg_policies where schemaname = 'public' and tablename = 'saas_users' and policyname = 'saas_users_read_own_row') = '(uid = app_current_uid())',
  'admin_still_needs_2fa_ok', position('aal2' in pg_get_functiondef('public.app_is_super_admin()'::regprocedure)) > 0,
  'rls_on_ok', (select relrowsecurity from pg_class where oid = 'public.saas_users'::regclass)
) as result;
