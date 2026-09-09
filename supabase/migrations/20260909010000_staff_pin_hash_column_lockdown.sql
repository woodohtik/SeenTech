-- =============================================================================
--  منع قراءة pin_hash عبر PostgREST مباشرة (ultra-review، بند حرج)
--  ------------------------------------------------------------------------
--  /api/staff/pins و/api/staff/verify-pin تقصر أرقام PIN الصريحة على
--  owner/super_admin عبر Express فقط -- لكن staff_read_own/staff_tenant_read
--  (RLS) لا تقيّدان أي عمود، وpin_hash كان له GRANT SELECT عام لـ
--  anon/authenticated. أي موظف (حتى كاشير) يقدر يستدعي مباشرة
--  supabase.from('staff').select('pin_hash') من devtools ويقرأ أرقام PIN
--  الصريحة لكل زملائه ولصاحب المحل، متجاوزاً القيد على مسار Express بالكامل.
--
--  الحل: سحب SELECT عن عمود pin_hash تحديداً من anon/authenticated (القراءة
--  الفعلية تبقى فقط عبر supabaseAdmin/service_role في server.ts، الذي لا
--  يتأثر بهذا السحب). أي استعلام عميل كان يعتمد على قراءة/تصفية pin_hash
--  (select('*') أو .not('pin_hash','is',null)) يُستبدَل بدالة RPC "وجود
--  فقط" (staff_ids_with_pin_set) لا تُرجع القيمة نفسها أبداً.
-- =============================================================================

REVOKE SELECT (pin_hash) ON public.staff FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.staff_ids_with_pin_set(p_tenant_id uuid)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (app_is_super_admin() OR p_tenant_id = app_current_tenant_id()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT id FROM public.staff WHERE tenant_id = p_tenant_id AND pin_hash IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_ids_with_pin_set(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_ids_with_pin_set(uuid) TO authenticated, service_role;
