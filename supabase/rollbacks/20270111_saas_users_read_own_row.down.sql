-- Rollback of 20270111000000_saas_users_read_own_row.sql
DROP POLICY IF EXISTS saas_users_read_own_row ON public.saas_users;
