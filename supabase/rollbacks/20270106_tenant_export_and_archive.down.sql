-- Rollback of 20270106000004_tenant_export_and_archive.sql (the export and archive tables are kept: they hold records).
DROP FUNCTION IF EXISTS public.export_tenant_data(uuid);
CREATE OR REPLACE FUNCTION public.permanently_delete_tenant(p_tenant_id uuid, p_confirm_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name       TEXT;
  v_trashed_at TIMESTAMPTZ;
BEGIN
  IF NOT public.app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT name, trashed_at INTO v_name, v_trashed_at FROM public.tenants WHERE id = p_tenant_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'التاجر غير موجود' USING ERRCODE = '42501';
  END IF;
  IF v_trashed_at IS NULL THEN
    RAISE EXCEPTION 'يجب نقل التاجر لسلة المهملات أولاً قبل الحذف النهائي' USING ERRCODE = '22023';
  END IF;
  IF v_name IS DISTINCT FROM p_confirm_name THEN
    RAISE EXCEPTION 'الاسم المُدخل لا يطابق اسم التاجر' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.tenants WHERE id = p_tenant_id;
END $function$
;
