-- Rollback of 20270107000002_support_access_consent.sql
DROP FUNCTION IF EXISTS public.start_support_session(uuid, uuid);
DROP FUNCTION IF EXISTS public.respond_support_access_request(uuid, boolean);
DROP POLICY IF EXISTS support_access_requests_shop_read ON public.support_access_requests;
DROP POLICY IF EXISTS support_sessions_shop_read ON public.support_sessions;
CREATE POLICY support_sessions_insert_self ON public.support_sessions FOR INSERT TO authenticated
  WITH CHECK (app_is_super_admin() AND (saas_user_id = (app_current_uid())::uuid));
DROP FUNCTION IF EXISTS public.app_is_shop_manager(uuid);
