-- seen-tailoring-order-fabric-units-task.md, batch D-3.
--
-- Fabric leaves stock when a tailoring order reaches the cutting stage, on
-- the server, in the same transaction as the status change. Until now the
-- browser did it before calling update_order_status: it looked the cloth up
-- by name, read the piece count as meters, and keyed the movement on
-- order + fabric, so a second line on the same cloth was silently dropped.
--
-- Additive: one nullable column, two new functions, and update_order_status
-- gains one step for tailoring-kind orders (same signature).

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS fabric_deducted_at timestamptz;

COMMENT ON COLUMN public.orders.fabric_deducted_at IS
  'When this order''s fabric was taken from stock (once, at the first stage at or after cutting). NULL = not yet.';

-- -----------------------------------------------------------------------
-- 1) deduct_order_fabric: internal. Takes each line's fabric from the
--    branch the order is cut from, once per order.
--
--    p_lines NULL  -> the order's own order_items rows (tailoring-kind).
--    p_lines array -> [{ line_key, fabric_id, meters }] supplied by the
--                     caller, for orders whose lines still live in notes.
--
--    Each movement is keyed on the line, so two lines on the same cloth are
--    both deducted and a repeat of the same line is a no-op.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deduct_order_fabric(
  p_order_id UUID,
  p_lines    JSONB DEFAULT NULL
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant    uuid;
  v_staff     uuid;
  v_branch    uuid;
  v_order_br  uuid;
  v_done      timestamptz;
  v_strategy  text;
  v_line      record;
  v_count     integer := 0;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT branch_id, fabric_deducted_at INTO v_order_br, v_done
    FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_done IS NOT NULL THEN
    RETURN 0;
  END IF;

  FOR v_line IN
    SELECT l.line_key, l.fabric_id, l.meters
      FROM (
        SELECT oi.id::text AS line_key, oi.fabric_id, COALESCE(oi.consumed_meters, 0) AS meters
          FROM public.order_items oi
         WHERE p_lines IS NULL
           AND oi.order_id = p_order_id AND oi.tenant_id = v_tenant
           AND oi.type = 'custom' AND oi.fabric_id IS NOT NULL
        UNION ALL
        SELECT x->>'line_key', NULLIF(x->>'fabric_id', '')::uuid,
               COALESCE(NULLIF(x->>'meters', '')::numeric, 0)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_lines) = 'array' THEN p_lines ELSE '[]'::jsonb END) x
      ) l
     WHERE l.fabric_id IS NOT NULL AND l.meters > 0
  LOOP
    IF v_line.line_key IS NULL OR btrim(v_line.line_key) = '' THEN
      RAISE EXCEPTION 'line_key مطلوب لكل سطر قماش' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.inventory_items WHERE id = v_line.fabric_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- Resolved on first need, so an order with nothing to deduct never fails
    -- for lack of a branch.
    IF v_branch IS NULL THEN
      SELECT inventory_strategy INTO v_strategy FROM public.tenants WHERE id = v_tenant;
      IF COALESCE(v_strategy, 'centralized') = 'centralized' THEN
        SELECT id INTO v_branch FROM public.branches
         WHERE tenant_id = v_tenant AND is_main = true LIMIT 1;
        IF v_branch IS NULL THEN
          RAISE EXCEPTION 'المستودع الرئيسي غير موجود' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_staff := public.app_current_staff_id();
        v_branch := COALESCE(v_order_br, (SELECT branch_id FROM public.staff WHERE id = v_staff));
        IF v_branch IS NULL THEN
          RAISE EXCEPTION 'لم يُحدَّد فرع لخصم القماش' USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;

    PERFORM public.apply_stock_movement(
      'order:' || p_order_id::text || ':line:' || v_line.line_key,
      v_branch, v_line.fabric_id, -abs(v_line.meters), 'deduction', p_order_id, 'order'
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.orders SET fabric_deducted_at = now() WHERE id = p_order_id;
  RETURN v_count;
END $$;

-- Internal: reachable only from the two status functions below.
REVOKE EXECUTE ON FUNCTION public.deduct_order_fabric(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------
-- 2) update_order_status: same signature and behaviour as 20261221000000,
--    plus: a tailoring-kind order that reaches cutting or any later working
--    stage has its fabric deducted here, once. An order moved straight from
--    measurements to sewing is deducted at that move.
-- -----------------------------------------------------------------------
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
  v_kind        text;
  v_deducted    timestamptz;
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
END $$;

REVOKE EXECUTE ON FUNCTION public.update_order_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_order_status(UUID, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------
-- 3) update_order_status_with_fabric: the status change the cutting dialog
--    confirms. p_fabric_lines carries the quantities the staff member
--    reviewed, [{ line_key, fabric_id, meters }]:
--      - tailoring-kind order: line_key is the order_items id; the reviewed
--        meters are saved on the line, then update_order_status deducts them.
--      - an older order (lines in notes): the lines are deducted directly.
--    Everything, including the status change, is one transaction: a short
--    stock aborts the move.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_order_status_with_fabric(
  p_order_id      UUID,
  p_status        TEXT,
  p_status_key    TEXT,
  p_fabric_lines  JSONB,
  p_notes         TEXT DEFAULT NULL,
  p_op_id         UUID DEFAULT NULL,
  p_history_note  TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant    uuid;
  v_role      text;
  v_kind      text;
  v_deducted  timestamptz;
  v_line      jsonb;
  v_meters    numeric;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_current_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager', 'cashier', 'tailor') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل حالة الطلب' USING ERRCODE = '42501';
  END IF;

  SELECT kind, fabric_deducted_at INTO v_kind, v_deducted
    FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_deducted IS NULL AND jsonb_typeof(p_fabric_lines) = 'array'
     AND p_status::order_status >= 'cutting'::order_status
     AND p_status::order_status <> 'cancelled'::order_status THEN
    IF v_kind = 'tailoring' THEN
      FOR v_line IN SELECT * FROM jsonb_array_elements(p_fabric_lines) LOOP
        v_meters := NULLIF(v_line->>'meters', '')::numeric;
        IF v_meters IS NULL OR v_meters < 0 THEN
          RAISE EXCEPTION 'كمية القماش غير صالحة' USING ERRCODE = '22023';
        END IF;
        UPDATE public.order_items
           SET consumed_meters = v_meters
         WHERE id = NULLIF(v_line->>'line_key', '')::uuid
           AND order_id = p_order_id AND tenant_id = v_tenant
           AND type = 'custom' AND fabric_id IS NOT NULL;
      END LOOP;
    ELSE
      PERFORM public.deduct_order_fabric(p_order_id, p_fabric_lines);
    END IF;
  END IF;

  RETURN public.update_order_status(p_order_id, p_status, p_status_key, p_notes, p_op_id, p_history_note);
END $$;

REVOKE EXECUTE ON FUNCTION public.update_order_status_with_fabric(UUID, TEXT, TEXT, JSONB, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_order_status_with_fabric(UUID, TEXT, TEXT, JSONB, TEXT, UUID, TEXT) TO authenticated;
