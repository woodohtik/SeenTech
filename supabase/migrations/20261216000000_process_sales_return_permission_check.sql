-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Fix-D
-- (whole-branch review finding I2).
--
-- action.refund was approved in Task 1's default-permission matrix but no
-- task ever wired it to process_sales_return -- the refund-processing RPC
-- still checked the old hardcoded owner/admin/manager role enum directly
-- (from 20261115010000_process_sales_return_server_side_rebuild.sql), the
-- exact UI/server gap this whole plan exists to close, left open for this
-- one key. This migration copies that function body verbatim and changes
-- only the gate: the role-enum check becomes an app_has_permission()
-- check, same pattern as Tasks 2-5. v_role is left assigned (now otherwise
-- unused) to keep the diff minimal, matching Tasks 3/4/5's precedent.
--
-- Per app_default_permission (20261205000000_app_has_permission.sql):
-- action.refund defaults to true for owner (short-circuit), admin,
-- manager, branch_manager, and accountant; false for cashier,
-- warehouse_manager, and tailor. This is NOT a restriction for admin --
-- admin keeps the same access it always had. It DOES newly grant
-- branch_manager and accountant server-side refund access they did not
-- have under the old hardcoded role check; both can still be overridden
-- per-tenant via roles.permissions or user_permission_overrides.

CREATE OR REPLACE FUNCTION public.process_sales_return(
  p_operation_id UUID,
  p_order_id     UUID,
  p_shift_id     UUID,
  p_items        JSONB,
  p_reason       TEXT DEFAULT NULL,
  p_refund_method payment_method DEFAULT 'cash'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant              uuid;
  v_staff               uuid;
  v_staff_name          text;
  v_role                text;
  v_op_key              text;
  v_existing            jsonb;
  v_return_id           uuid := p_operation_id;
  v_return_number       text;

  v_order_branch        uuid;
  v_order_tax_rate      numeric;
  v_order_discount      numeric;
  v_order_total         numeric;
  v_order_paid          numeric;
  v_order_subtotal_full numeric;
  v_order_gross_full    numeric;
  v_discount_ratio      numeric;

  v_invoice_id          uuid;
  v_already_refunded    numeric;
  v_refundable_ceiling  numeric;

  v_item                jsonb;
  v_order_item_id       uuid;
  v_requested_qty       numeric;
  v_sold_qty            numeric;
  v_already_returned    numeric;
  v_line_type           order_item_type;
  v_line_item_id        uuid;
  v_line_variant_id     uuid;
  v_line_price          numeric;
  v_line_name           text;

  v_subtotal_returned   numeric := 0;
  v_lines_resolved      jsonb := '[]'::jsonb;

  v_refund_exvat        numeric;
  v_refund_tax          numeric;
  v_refund_gross        numeric;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار المرتجع' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'sales_return:' || p_operation_id::text;

  SELECT result INTO v_existing
    FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_role := public.app_current_role();
  IF NOT public.app_has_permission('action.refund') THEN
    RAISE EXCEPTION 'لا تملك صلاحية معالجة المرتجعات' USING ERRCODE = '42501';
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;

  -- Require the caller's own open shift (same requirement create_pos_sale
  -- has) -- a cash refund must affect a real, currently-open drawer, not
  -- an arbitrary client-supplied branch with no shift behind it.
  IF p_shift_id IS NULL THEN
    RAISE EXCEPTION 'لا توجد وردية مفتوحة -- افتح وردية قبل معالجة مرتجع' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.shifts
   WHERE id = p_shift_id AND tenant_id = v_tenant AND staff_id = v_staff AND status = 'open'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الوردية المحدَّدة غير مفتوحة أو لا تخصّك' USING ERRCODE = '22023';
  END IF;

  SELECT branch_id, tax_rate, discount_amount, total_amount, paid_amount
    INTO v_order_branch, v_order_tax_rate, v_order_discount, v_order_total, v_order_paid
    FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_invoice_id FROM public.tax_invoices WHERE order_id = p_order_id AND tenant_id = v_tenant;

  -- Reconstruct the order's own discount ratio (same derivation as
  -- create_pos_sale) so a partial return of a discounted sale refunds
  -- proportionally, not at the item's undiscounted face value.
  v_order_subtotal_full := CASE WHEN v_order_tax_rate > 0 THEN v_order_total / (1 + v_order_tax_rate) ELSE v_order_total END;
  v_order_gross_full := v_order_subtotal_full + v_order_discount;
  v_discount_ratio := CASE WHEN v_order_gross_full > 0 THEN v_order_subtotal_full / v_order_gross_full ELSE 1 END;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'لا يوجد صنف محدَّد للإرجاع' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_order_item_id := (v_item->>'order_item_id')::uuid;
    v_requested_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    IF v_requested_qty <= 0 THEN
      RAISE EXCEPTION 'كمية الإرجاع يجب أن تكون أكبر من صفر' USING ERRCODE = '22023';
    END IF;

    SELECT type, item_id, variant_id, price, quantity, name
      INTO v_line_type, v_line_item_id, v_line_variant_id, v_line_price, v_sold_qty, v_line_name
      FROM public.order_items
     WHERE id = v_order_item_id AND order_id = p_order_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'عنصر الطلب غير موجود في هذا الطلب' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(SUM(sri.quantity), 0) INTO v_already_returned
      FROM public.sales_return_items sri
      JOIN public.sales_returns sr ON sr.id = sri.return_id
     WHERE sri.order_item_id = v_order_item_id AND sr.tenant_id = v_tenant;

    IF v_requested_qty > (v_sold_qty - v_already_returned) THEN
      RAISE EXCEPTION 'الكمية المطلوب إرجاعها (%) أكبر من المتاح لإرجاعه (%) لهذا الصنف', v_requested_qty, (v_sold_qty - v_already_returned)
        USING ERRCODE = '22023';
    END IF;

    v_subtotal_returned := v_subtotal_returned + ROUND(v_line_price * v_requested_qty, 2);
    v_lines_resolved := v_lines_resolved || jsonb_build_object(
      'order_item_id', v_order_item_id, 'type', v_line_type, 'item_id', v_line_item_id,
      'variant_id', v_line_variant_id, 'price', v_line_price, 'quantity', v_requested_qty, 'name', v_line_name
    );
  END LOOP;

  v_refund_exvat := ROUND(v_subtotal_returned * v_discount_ratio, 2);
  v_refund_tax := ROUND(v_refund_exvat * v_order_tax_rate, 2);
  v_refund_gross := v_refund_exvat + v_refund_tax;

  SELECT COALESCE(SUM(refunded_amount), 0) INTO v_already_refunded
    FROM public.sales_returns WHERE order_id = p_order_id AND tenant_id = v_tenant;
  v_refundable_ceiling := GREATEST(COALESCE(v_order_paid, 0) - v_already_refunded, 0);
  v_refund_gross := LEAST(v_refund_gross, v_refundable_ceiling);

  SELECT 'RET-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(v_return_id::text, 1, 8) INTO v_return_number;

  INSERT INTO public.sales_returns (
    id, tenant_id, invoice_id, order_id, shift_id, return_number, status, reason,
    total_amount, refunded_amount, refund_method, processed_by, returned_at, created_at
  ) VALUES (
    v_return_id, v_tenant, v_invoice_id, p_order_id, p_shift_id, v_return_number, 'completed',
    NULLIF(p_reason, ''), v_refund_gross, v_refund_gross, p_refund_method, v_staff, now(), now()
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_lines_resolved) LOOP
    v_line_price := (v_item->>'price')::numeric;
    INSERT INTO public.sales_return_items (
      id, tenant_id, return_id, order_item_id, item_id, name, quantity, unit_price, total
    ) VALUES (
      gen_random_uuid(), v_tenant, v_return_id,
      (v_item->>'order_item_id')::uuid, NULLIF(v_item->>'item_id', '')::uuid, v_item->>'name',
      (v_item->>'quantity')::numeric, v_line_price,
      ROUND(v_line_price * (v_item->>'quantity')::numeric, 2)
    );

    IF (v_item->>'type') = 'ready_made' AND NULLIF(v_item->>'item_id', '') IS NOT NULL AND v_order_branch IS NOT NULL THEN
      PERFORM public.apply_stock_movement(
        v_op_key || ':item:' || (v_item->>'order_item_id'),
        v_order_branch, (v_item->>'item_id')::uuid,
        abs((v_item->>'quantity')::numeric), 'addition', v_return_id, 'sales_return',
        NULLIF(v_item->>'variant_id', '')::uuid
      );
    END IF;
  END LOOP;

  INSERT INTO public.employee_activity_logs (
    tenant_id, staff_id, staff_name, action, details, occurred_at
  ) VALUES (
    v_tenant, v_staff, COALESCE(v_staff_name, 'System'), 'create_sales_return',
    'مرتجع بقيمة ' || v_refund_gross::text || ' على الطلب ' || p_order_id::text, now()
  );

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'sales_return',
          jsonb_build_object('return_id', v_return_id, 'return_number', v_return_number,
                              'refunded_amount', v_refund_gross, 'tax_amount', v_refund_tax));

  RETURN jsonb_build_object('return_id', v_return_id, 'return_number', v_return_number,
                             'refunded_amount', v_refund_gross, 'tax_amount', v_refund_tax, 'replayed', false);
END $$;

REVOKE EXECUTE ON FUNCTION public.process_sales_return(UUID,UUID,UUID,JSONB,TEXT,payment_method) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.process_sales_return(UUID,UUID,UUID,JSONB,TEXT,payment_method) TO authenticated;
