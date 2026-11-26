-- seen-order-images-upload-task.md, phases 3-4 (question 4): photos can be
-- added or removed later from "edit order" (offline, or forgotten at
-- creation). update_tailoring_order re-prices the order and is not the place;
-- this sets the photo list alone.
--
-- At most 6; each a path in THIS order's own folder (<tenant>/<order>/...)
-- or a link the order already had (older orders). The shop's staff with
-- orders.edit or orders.create.
--
-- Test: supabase/tests/set_order_images_test.sql
-- Rollback: supabase/rollbacks/20270122_set_order_images.down.sql

CREATE OR REPLACE FUNCTION public.set_order_images(p_order_id uuid, p_images jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant  uuid;
  v_current jsonb;
  v_prefix  text;
  v_item    text;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL OR NOT (public.app_has_permission('orders.edit') OR public.app_has_permission('orders.create')) THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل الطلب' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(images, '[]'::jsonb) INTO v_current FROM public.orders WHERE id = p_order_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_images IS NULL OR jsonb_typeof(p_images) <> 'array' THEN
    RAISE EXCEPTION 'قائمة الصور غير صحيحة' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_images) > 6 THEN
    RAISE EXCEPTION 'الحد 6 صور للطلب' USING ERRCODE = '22023';
  END IF;

  v_prefix := v_tenant::text || '/' || p_order_id::text || '/';
  FOR v_item IN SELECT value #>> '{}' FROM jsonb_array_elements(p_images) LOOP
    IF v_item IS NULL OR NOT (starts_with(v_item, v_prefix) OR v_current ? v_item) THEN
      RAISE EXCEPTION 'صورة ليست من هذا الطلب' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  UPDATE public.orders SET images = p_images, updated_at = now() WHERE id = p_order_id;
  RETURN p_images;
END $function$;

REVOKE ALL ON FUNCTION public.set_order_images(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_order_images(uuid, jsonb) TO authenticated;
