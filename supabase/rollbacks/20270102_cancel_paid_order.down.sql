-- Rollback of 20270102000004_cancel_paid_order.sql.
DROP FUNCTION IF EXISTS public.cancel_order(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.update_order_status(p_order_id uuid, p_status text, p_status_key text, p_notes text DEFAULT NULL::text, p_op_id uuid DEFAULT NULL::uuid, p_history_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant      uuid;
  v_role        text;
  v_staff       uuid;
  v_staff_name  text;
  v_op_key      text;
  v_existing    jsonb;
  v_total       numeric;
  v_paid        numeric;
  v_status      order_status;
  v_kind        text;
  v_deducted    timestamptz;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_current_role();
  IF NOT public.app_has_permission('orders.update_status') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل حالة الطلب' USING ERRCODE = '42501';
  END IF;

  IF p_op_id IS NOT NULL THEN
    v_op_key := 'update_order_status:' || p_op_id::text;
    SELECT result INTO v_existing FROM public.stock_operations
     WHERE operation_id = v_op_key AND tenant_id = v_tenant;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing || jsonb_build_object('replayed', true);
    END IF;
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;

  SELECT total_amount, paid_amount, status, kind, fabric_deducted_at
    INTO v_total, v_paid, v_status, v_kind, v_deducted
    FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن تعديل طلب تم تسليمه أو إلغاؤه' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'delivered' AND round(v_total - v_paid, 2) > 0 THEN
    RAISE EXCEPTION 'لا يمكن تسليم طلب عليه مبلغ متبقٍ' USING ERRCODE = '23514';
  END IF;

  UPDATE public.orders SET
    status      = p_status::order_status,
    status_key  = p_status_key,
    notes       = CASE WHEN v_kind = 'tailoring' THEN notes ELSE COALESCE(p_notes, notes) END,
    updated_at  = now()
  WHERE id = p_order_id;

  -- order_status sorts measurements_taken < cutting < ... < delivered <
  -- cancelled, so "cutting or later, not cancelled" is a range check.
  IF v_kind = 'tailoring' AND v_deducted IS NULL
     AND p_status::order_status >= 'cutting'::order_status
     AND p_status::order_status <> 'cancelled'::order_status THEN
    PERFORM public.deduct_order_fabric(p_order_id, NULL);
  END IF;

  INSERT INTO public.order_history (tenant_id, order_id, status, notes, updated_by_staff, updated_by_name)
  VALUES (v_tenant, p_order_id, p_status::order_status, p_history_note, v_staff, COALESCE(v_staff_name, 'Staff'));

  IF p_op_id IS NOT NULL THEN
    INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
    VALUES (v_op_key, v_tenant, 'update_order_status', jsonb_build_object(
      'order_id', p_order_id, 'status', p_status, 'status_key', p_status_key
    ));
  END IF;

  RETURN jsonb_build_object('order_id', p_order_id, 'status', p_status, 'status_key', p_status_key, 'replayed', false);
END $function$;
