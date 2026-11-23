-- A platform admin with two-factor on could not open the admin panel.
--
-- 20270107000000 (SECURITY-06) made app_is_super_admin() true only in a
-- two-factor (aal2) session for an account with two-factor enabled -- right
-- for every admin power. But the only SELECT policy on saas_users is
-- "app_is_super_admin()", and get_session_identity() (SECURITY INVOKER) reads
-- the caller's own saas_users row through it. Straight after the password,
-- before the code (aal1), the admin could not see their own row, the app
-- took them for a new user and showed sign-up -- never reaching the
-- two-factor screen that would have raised the session to aal2.
--
-- Each signed-in user may read their own row: their role and whether it is
-- active, nothing about anyone else. Every admin power still goes through
-- app_is_super_admin(), which still requires aal2.
CREATE POLICY saas_users_read_own_row ON public.saas_users
  FOR SELECT TO authenticated
  USING (uid = public.app_current_uid());
