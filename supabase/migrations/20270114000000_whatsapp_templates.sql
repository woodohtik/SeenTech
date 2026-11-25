-- seen-whatsapp-templates-task.md, phase 2: four templates, one per message.
--
-- tenants.whatsapp_settings becomes
--   { enabled, templates: { order_received, invoice, tracking_link, measurements_link } }
-- and keeps its old `template` key until everything is confirmed (it is the
-- order-received and invoice template for an app that has not updated yet).
--
-- 1. save_whatsapp_templates(p_enabled, p_templates): settings.whatsapp (the
--    owner, admin and manager by default; never the cashier). Each template
--    one of the four keys, text, not empty, 1000 characters at most. The ones
--    sent replace the stored ones; the others stay.
-- 2. The old save_whatsapp_settings keeps the templates when an old copy of
--    the app calls it (it used to rebuild the whole object).
-- 3. Once: a shop's old template becomes its order_received and invoice
--    template (question 2), so no shop loses its own wording.

CREATE OR REPLACE FUNCTION public.save_whatsapp_templates(p_enabled boolean, p_templates jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid := public.app_current_tenant_id();
  v_current  jsonb;
  v_templates jsonb;
  v_key      text;
  v_text     text;
BEGIN
  IF v_tenant IS NULL OR NOT public.app_has_permission('settings.whatsapp') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إعدادات واتساب' USING ERRCODE = '42501';
  END IF;
  IF p_templates IS NOT NULL AND jsonb_typeof(p_templates) <> 'object' THEN
    RAISE EXCEPTION 'قوالب واتساب غير صحيحة' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(whatsapp_settings, '{}'::jsonb) INTO v_current FROM public.tenants WHERE id = v_tenant FOR UPDATE;
  v_templates := CASE WHEN jsonb_typeof(v_current -> 'templates') = 'object' THEN v_current -> 'templates' ELSE '{}'::jsonb END;

  FOR v_key, v_text IN SELECT key, value #>> '{}' FROM jsonb_each(COALESCE(p_templates, '{}'::jsonb)) LOOP
    IF v_key NOT IN ('order_received', 'invoice', 'tracking_link', 'measurements_link') THEN
      RAISE EXCEPTION 'قالب واتساب غير معروف: %', v_key USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_templates -> v_key) <> 'string' OR btrim(COALESCE(v_text, '')) = '' THEN
      RAISE EXCEPTION 'قالب الرسالة لا يكون فارغاً' USING ERRCODE = '22023';
    END IF;
    IF length(v_text) > 1000 THEN
      RAISE EXCEPTION 'نص الرسالة أطول من 1000 حرف' USING ERRCODE = '22023';
    END IF;
    v_templates := v_templates || jsonb_build_object(v_key, v_text);
  END LOOP;

  v_current := v_current || jsonb_build_object('templates', v_templates);
  IF p_enabled IS NOT NULL THEN
    v_current := v_current || jsonb_build_object('enabled', p_enabled);
  END IF;
  UPDATE public.tenants SET whatsapp_settings = v_current WHERE id = v_tenant;
  RETURN v_current;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_whatsapp_templates(boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_whatsapp_templates(boolean, jsonb) TO authenticated;

-- The old one, for an app that has not updated yet: same checks as before,
-- but it merges into the stored settings instead of rebuilding them, so the
-- four templates survive a switch flipped from an old copy.
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
  SELECT COALESCE(whatsapp_settings, '{}'::jsonb) INTO v_settings FROM public.tenants WHERE id = v_tenant FOR UPDATE;
  v_settings := (v_settings - 'template') || jsonb_strip_nulls(jsonb_build_object('enabled', p_enabled, 'template', NULLIF(btrim(COALESCE(p_template, '')), '')));
  UPDATE public.tenants SET whatsapp_settings = v_settings WHERE id = v_tenant;
  RETURN v_settings;
END;
$function$;

-- Once: the old template is the shop's order-received and invoice template.
UPDATE public.tenants
   SET whatsapp_settings = whatsapp_settings || jsonb_build_object(
         'templates',
         COALESCE(whatsapp_settings -> 'templates', '{}'::jsonb)
           || jsonb_build_object('order_received', whatsapp_settings ->> 'template', 'invoice', whatsapp_settings ->> 'template'))
 WHERE COALESCE(btrim(whatsapp_settings ->> 'template'), '') <> ''
   AND (whatsapp_settings -> 'templates') IS NULL;
