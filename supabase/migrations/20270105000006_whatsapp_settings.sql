-- seen-readiness-fixes-task.md P4 (OPERATIONS-13) -- WhatsApp settings
-- belong to the shop, not to one browser.
--
-- Before: the message template and the "WhatsApp on" switch lived in each
-- device's localStorage -- set on the owner's laptop, unknown to the
-- cashier's tablet -- and the switch changed nothing anywhere.
--
-- Now: tenants.whatsapp_settings {enabled, template}, readable by the shop
-- (the tenants row it already reads), written by save_whatsapp_settings
-- (settings.whatsapp). The send buttons follow it.
-- Rollback: supabase/rollbacks/20270105_whatsapp_settings.down.sql

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS whatsapp_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.save_whatsapp_settings(p_enabled boolean, p_template text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.app_current_tenant_id();
  v_settings jsonb;
BEGIN
  IF v_tenant IS NULL OR NOT public.app_has_permission('settings.whatsapp') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إعدادات واتساب' USING ERRCODE = '42501';
  END IF;
  IF p_template IS NOT NULL AND length(p_template) > 2000 THEN
    RAISE EXCEPTION 'نص الرسالة أطول من 2000 حرف' USING ERRCODE = '22023';
  END IF;
  v_settings := jsonb_strip_nulls(jsonb_build_object('enabled', p_enabled, 'template', NULLIF(btrim(COALESCE(p_template, '')), '')));
  UPDATE public.tenants SET whatsapp_settings = v_settings WHERE id = v_tenant;
  RETURN v_settings;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_whatsapp_settings(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_whatsapp_settings(boolean, text) TO authenticated;
