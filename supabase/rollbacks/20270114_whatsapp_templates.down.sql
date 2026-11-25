-- Rollback of 20270114000000_whatsapp_templates.sql.
-- The templates key stays in whatsapp_settings (harmless: the old app reads `template`).
DROP FUNCTION IF EXISTS public.save_whatsapp_templates(boolean, jsonb);

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
