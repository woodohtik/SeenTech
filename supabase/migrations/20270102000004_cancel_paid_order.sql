-- seen-readiness-fixes-task.md P1.4 (MONEY-05, founder question 4) --
-- cancelling a paid order gives the money back, from a shift.
--
-- Before: any order not delivered could be cancelled with one tap; the money
-- paid on it stayed recorded as taken, an issued tax invoice stayed without a
-- credit note, and a refund handed over at the counter showed as a shortage.
-- Now:
--  * update_order_status refuses to cancel an order with money paid on it;
--  * cancel_order(operation, order, reason): a reason is required; when money
--    was paid it needs action.refund and the employee's open shift, and gives
--    back what is still due -- by a credit note when the order was invoiced
--    (it reaches ZATCA and the VAT return), otherwise as a cash payout from
--    the shift (close_shift already subtracts payouts); then the order is
--    cancelled (the vertical's cancel stage) and the reason goes in its history.
--  * Customer credit (founder question 4, option b) needs a credit ledger the
--    system does not have yet -- left for the founder; refunds are cash.
-- Rollback: supabase/rollbacks/20270102_cancel_paid_order.down.sql

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

  -- seen-readiness-fixes-task.md P1.4 (MONEY-05): a paid order is cancelled
  -- only through cancel_order(), which gives the money back from a shift.
  IF p_status = 'cancelled' AND v_paid > 0 THEN
    RAISE EXCEPTION 'على هذا الطلب مبلغ مدفوع: ألغِه من «إلغاء مع رد المبلغ»' USING ERRCODE = '22023', HINT = 'cancel_with_refund';
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

CREATE OR REPLACE FUNCTION public.cancel_order(p_operation_id uuid, p_order_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant     uuid;
  v_staff      uuid;
  v_staff_name text;
  v_op_key     text;
  v_existing   jsonb;
  v_order      record;
  v_invoice_id uuid;
  v_refunded   numeric;
  v_due        numeric := 0;
  v_shift      uuid;
  v_cancel_key text;
  v_result     jsonb;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار الإلغاء' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'اكتب سبب الإلغاء' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.app_has_permission('orders.update_status') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل حالة الطلب' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'cancel_order:' || p_operation_id::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_op_key, 0));
  SELECT result INTO v_existing FROM public.stock_operations WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_staff := public.app_actor_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;

  SELECT o.id, o.status, o.paid_amount, o.order_number INTO v_order
    FROM public.orders o WHERE o.id = p_order_id AND o.tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_order.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن إلغاء طلب تم تسليمه أو إلغاؤه' USING ERRCODE = '22023';
  END IF;

  -- What is still to give back: paid, less what credit notes already returned.
  SELECT COALESCE(SUM(refunded_amount), 0) INTO v_refunded FROM public.sales_returns
   WHERE order_id = p_order_id AND tenant_id = v_tenant;
  v_due := GREATEST(round(COALESCE(v_order.paid_amount, 0) - v_refunded, 2), 0);

  IF v_due > 0 THEN
    IF NOT public.app_has_permission('action.refund') THEN
      RAISE EXCEPTION 'على الطلب مبلغ مدفوع، وردّه يحتاج صلاحية المرتجع' USING ERRCODE = '42501';
    END IF;
    SELECT id INTO v_shift FROM public.shifts
     WHERE tenant_id = v_tenant AND staff_id = v_staff AND status = 'open'
     ORDER BY start_time DESC LIMIT 1;
    IF v_shift IS NULL THEN
      RAISE EXCEPTION 'افتح وردية قبل رد المبلغ' USING ERRCODE = '22023', HINT = 'no_open_shift';
    END IF;

    SELECT id INTO v_invoice_id FROM public.tax_invoices
     WHERE order_id = p_order_id AND tenant_id = v_tenant
     ORDER BY created_at LIMIT 1;
    IF v_invoice_id IS NOT NULL THEN
      -- An invoiced sale is reversed by a credit note (it reaches ZATCA and the
      -- VAT return); issue_credit_note records the cash refund on this shift.
      PERFORM public.issue_credit_note(gen_random_uuid(), v_invoice_id, v_due,
        'إلغاء الطلب: ' || btrim(p_reason), 'cash');
    ELSE
      -- A deposit with no invoice yet: the cash leaves this shift's drawer.
      INSERT INTO public.shift_entries (tenant_id, shift_id, entry_type, amount, reason, created_by)
      VALUES (v_tenant, v_shift, 'payout', v_due,
              'رد مبلغ طلب ملغى #' || coalesce(v_order.order_number::text, '') || ': ' || btrim(p_reason), v_staff);
    END IF;
  END IF;

  SELECT s.stage_key INTO v_cancel_key
    FROM public.vertical_workflow_stages s JOIN public.tenants t ON t.vertical = s.vertical_key
   WHERE t.id = v_tenant AND s.phase = 'cancelled' LIMIT 1;

  UPDATE public.orders SET status = 'cancelled', status_key = COALESCE(v_cancel_key, 'cancelled'), updated_at = now()
   WHERE id = p_order_id;
  -- Cloth leaves the stock at cutting; an order cancelled before it never
  -- took any, and cloth already cut is spent, so there is nothing to put back.

  INSERT INTO public.order_history (tenant_id, order_id, status, notes, updated_by_staff, updated_by_name)
  VALUES (v_tenant, p_order_id, 'cancelled',
          'إلغاء: ' || btrim(p_reason) || CASE WHEN v_due > 0 THEN ' — رُدّ ' || v_due::text || ' نقداً' ELSE '' END,
          v_staff, COALESCE(v_staff_name, 'Staff'));

  v_result := jsonb_build_object('order_id', p_order_id, 'refunded', v_due,
                                 'credit_note', v_invoice_id IS NOT NULL AND v_due > 0, 'shift_id', v_shift);
  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result) VALUES (v_op_key, v_tenant, 'cancel_order', v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_order(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, uuid, text) TO authenticated, service_role;
