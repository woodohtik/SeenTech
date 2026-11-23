-- seen-readiness-fixes-task.md P6 (SECURITY-11) -- the shop sees and answers
-- support access requests, and sees every support session in its shop.
--
--  * support_access_requests: the shop's owner (or an owner/admin employee of
--    that shop) reads its requests; respond_support_access_request answers
--    one (pending and not expired only), recording who and when.
--  * start_support_session(tenant, request): the only way a session row is
--    written. With an approved, unexpired request of this admin for this
--    shop it is 'explicit'; without one it is 'stealth'. The label is the
--    server's, never the browser's (the direct INSERT policy is dropped).
--  * support_sessions: the shop's owner / owner-admin employees read the
--    sessions in their shop, stealth included.
--  * the old saas_settings copy of requests is cleared.
-- Rollback: supabase/rollbacks/20270107_support_access_consent.down.sql

ALTER TABLE public.support_access_requests
  ADD COLUMN IF NOT EXISTS responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS responded_by text;

CREATE OR REPLACE FUNCTION public.app_is_shop_manager(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- COALESCE: app_current_tenant_id() is NULL for a locked shop, and a NULL
  -- here would slip through an IF NOT ... check.
  SELECT COALESCE(p_tenant_id IS NOT NULL AND (
       app_is_tenant_owner(p_tenant_id)
    OR (p_tenant_id = app_current_tenant_id() AND app_current_role()::text IN ('owner', 'admin'))
  ), false);
$function$;
REVOKE ALL ON FUNCTION public.app_is_shop_manager(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_is_shop_manager(uuid) TO authenticated;

DROP POLICY IF EXISTS support_access_requests_shop_read ON public.support_access_requests;
CREATE POLICY support_access_requests_shop_read ON public.support_access_requests FOR SELECT TO authenticated
  USING (app_is_shop_manager(tenant_id));

DROP POLICY IF EXISTS support_sessions_shop_read ON public.support_sessions;
CREATE POLICY support_sessions_shop_read ON public.support_sessions FOR SELECT TO authenticated
  USING (app_is_shop_manager(tenant_id));
DROP POLICY IF EXISTS support_sessions_insert_self ON public.support_sessions;

CREATE OR REPLACE FUNCTION public.respond_support_access_request(p_request_id uuid, p_approve boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req record;
  v_status text := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
BEGIN
  SELECT * INTO v_req FROM public.support_access_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL OR NOT app_is_shop_manager(v_req.tenant_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'تمت الإجابة على هذا الطلب من قبل' USING ERRCODE = '22023';
  END IF;
  IF v_req.expires_at IS NOT NULL AND v_req.expires_at < now() THEN
    UPDATE public.support_access_requests SET status = 'expired' WHERE id = p_request_id;
    RAISE EXCEPTION 'انتهت صلاحية هذا الطلب' USING ERRCODE = '22023';
  END IF;
  UPDATE public.support_access_requests
     SET status = v_status, responded_at = now(), responded_by = app_current_uid()
   WHERE id = p_request_id;
  RETURN v_status;
END;
$function$;
REVOKE ALL ON FUNCTION public.respond_support_access_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_support_access_request(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_support_session(p_tenant_id uuid, p_request_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  text := app_current_uid();
  v_name text;
  v_type text := 'stealth';
  v_id   uuid;
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'المحل غير موجود' USING ERRCODE = '02000';
  END IF;
  IF p_request_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.support_access_requests r
                WHERE r.id = p_request_id AND r.tenant_id = p_tenant_id AND r.status = 'approved'
                  AND r.saas_user_id::text = v_uid
                  AND (r.expires_at IS NULL OR r.expires_at > now() - interval '15 minutes')) THEN
      v_type := 'explicit';
    ELSE
      RAISE EXCEPTION 'لا توجد موافقة صالحة من المحل على هذا الطلب' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT COALESCE(name, email::text) INTO v_name FROM public.saas_users WHERE uid = v_uid;
  INSERT INTO public.support_sessions (tenant_id, saas_user_id, saas_user_name, access_type, started_at)
  VALUES (p_tenant_id, v_uid::uuid, COALESCE(v_name, 'Seen support'), v_type, now())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('session_id', v_id, 'access_type', v_type);
END;
$function$;
REVOKE ALL ON FUNCTION public.start_support_session(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_support_session(uuid, uuid) TO authenticated;

DELETE FROM public.saas_settings WHERE key = 'support_access_requests';
