-- seen-status-fix-regressions-task.md item 1 (full spec, after the first
-- pass in 20261124000000_order_status_update_rpc.sql):
--   - idempotency: p_op_id, same pattern as record_order_payment's
--     stock_operations dedup (a retried network call must not append the
--     same history entry twice).
--   - transition guard: block any change once an order is already
--     'cancelled' OR 'delivered' (the first pass only blocked 'delivered').
--   - write a REAL `order_history` row in the same transaction, not only
--     the client-side notes-encoded blob -- the blob is invisible to any
--     caller that is not the exact JS fetch interceptor (see
--     20261115040000's header comment), so it is not a real audit trail.
--     p_notes here keeps writing the encoded blob too (Orders.tsx still
--     reads order.history from it for the on-screen timeline), but
--     order_history is now the durable, queryable copy.
--
-- CREATE OR REPLACE with p_op_id appended as a new, defaulted, trailing
-- parameter keeps the existing 4-argument call sites (Orders.tsx
-- updateStatus/confirmDelivery, already wired to this RPC) working
-- unchanged; they're updated in the same commit to also pass p_op_id.

-- CREATE OR REPLACE cannot change a function's argument list (it would
-- create a second, separate overload instead of replacing the first) --
-- drop the 4-argument version from 20261124000000 explicitly so only this
-- 6-argument version exists afterward.
DROP FUNCTION IF EXISTS public.update_order_status(UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id      UUID,
  p_status        TEXT,
  p_status_key    TEXT,
  p_notes         TEXT DEFAULT NULL,
  p_op_id         UUID DEFAULT NULL,
  p_history_note  TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_current_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager', 'cashier', 'tailor') THEN
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

  SELECT total_amount, paid_amount, status INTO v_total, v_paid, v_status
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
    notes       = COALESCE(p_notes, notes),
    updated_at  = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_history (tenant_id, order_id, status, notes, updated_by_staff, updated_by_name)
  VALUES (v_tenant, p_order_id, p_status::order_status, p_history_note, v_staff, COALESCE(v_staff_name, 'Staff'));

  IF p_op_id IS NOT NULL THEN
    INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
    VALUES (v_op_key, v_tenant, 'update_order_status', jsonb_build_object(
      'order_id', p_order_id, 'status', p_status, 'status_key', p_status_key
    ));
  END IF;

  RETURN jsonb_build_object('order_id', p_order_id, 'status', p_status, 'status_key', p_status_key, 'replayed', false);
END $$;

REVOKE EXECUTE ON FUNCTION public.update_order_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_order_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;
