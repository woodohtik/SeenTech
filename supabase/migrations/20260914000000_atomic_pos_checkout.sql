-- =============================================================================
--  POS checkout as one atomic, idempotent RPC
--  (seen-offline-sync-architecture-task.md Phase 0 -- mandatory before any
--  offline work: POS.tsx's handleCheckout previously ran 6 separate writes
--  with no shared transaction -- orders -> order_items -> order_history ->
--  tax_invoices -> employee_activity_logs -> per-item stock deduction, the
--  last step wrapped in a try/catch that only console.error'd on failure.
--  Any interruption mid-sequence (even today, with no "offline mode" at all)
--  left an order with no items, no invoice, or silently un-deducted stock.
--
--  This function does all of it inside one Postgres transaction, keyed by a
--  client-generated operation_id that doubles as the new order's own id --
--  the same id an offline outbox (Phase 3) will later replay verbatim, so a
--  retried submission after a dropped connection can never create the sale
--  twice. Stock movements reuse apply_stock_movement (already atomic,
--  idempotent, and negative-guarded) instead of reimplementing that logic.
--
--  Any failure -- including insufficient stock -- rolls back the entire
--  sale rather than leaving a partial order behind. That's a deliberate,
--  more conservative behavior than the "record the sale, flag the stock
--  line as a conflict" design the task's Phase 4 calls for: that behavior
--  is specifically for the offline scenario (two disconnected devices
--  selling the last unit concurrently, where the customer has already
--  paid and the sale can't be undone) and needs the outbox/conflict UI from
--  Phases 2-4 to mean anything. Building it now, before that infrastructure
--  exists, would have no real conflict queue to land in.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_pos_sale(
  p_operation_id UUID,   -- becomes orders.id; also the idempotency key
  p_order        JSONB,  -- order-level fields (see POS.tsx for the shape)
  p_items        JSONB,  -- array of order_items rows
  p_invoice      JSONB   -- invoice_number/subtotal/vat_number/notes
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant     uuid;
  v_staff      uuid;
  v_staff_name text;
  v_branch     uuid;
  v_order_id   uuid := p_operation_id;
  v_op_key     text;
  v_existing   jsonb;
  v_item       jsonb;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار البيع' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'pos_sale:' || p_operation_id::text;

  SELECT result INTO v_existing
    FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;
  v_branch := NULLIF(p_order->>'branch_id', '')::uuid;

  INSERT INTO public.orders (
    id, tenant_id, branch_id, shift_id, customer_id, customer_name,
    order_number, status, payment_method, total_amount, paid_amount,
    tax_rate, tax_amount, discount_amount, order_date, delivery_date,
    qr_code, notes, created_by, created_at
  ) VALUES (
    v_order_id, v_tenant, v_branch,
    NULLIF(p_order->>'shift_id', '')::uuid,
    NULLIF(p_order->>'customer_id', '')::uuid,
    p_order->>'customer_name',
    (p_order->>'order_number')::bigint,
    (p_order->>'status')::order_status,
    (p_order->>'payment_method')::payment_method,
    (p_order->>'total_amount')::numeric,
    (p_order->>'paid_amount')::numeric,
    (p_order->>'tax_rate')::numeric,
    (p_order->>'tax_amount')::numeric,
    (p_order->>'discount_amount')::numeric,
    (p_order->>'order_date')::timestamptz,
    (p_order->>'delivery_date')::timestamptz,
    p_order->>'qr_code',
    p_order->>'notes',
    v_staff,
    (p_order->>'order_date')::timestamptz
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.order_items (
      tenant_id, order_id, type, status, item_id, name, garment_type, fabric,
      fabric_id, quantity, selected_unit, consumed_meters, price,
      closure_type, closure_visibility, collar_type, cuff_type, pocket_type,
      chest_style, collar_padding, additions, embroidery, measurements
    ) VALUES (
      v_tenant, v_order_id,
      (v_item->>'type')::order_item_type,
      NULLIF(v_item->>'status', '')::order_status,
      NULLIF(v_item->>'item_id', '')::uuid,
      v_item->>'name', v_item->>'garment_type', v_item->>'fabric',
      NULLIF(v_item->>'fabric_id', '')::uuid,
      (v_item->>'quantity')::numeric,
      NULLIF(v_item->>'selected_unit', '')::inventory_unit,
      NULLIF(v_item->>'consumed_meters', '')::numeric,
      (v_item->>'price')::numeric,
      NULLIF(v_item->>'closure_type', '')::closure_type,
      NULLIF(v_item->>'closure_visibility', '')::closure_visibility,
      v_item->>'collar_type', v_item->>'cuff_type', v_item->>'pocket_type',
      v_item->>'chest_style',
      NULLIF(v_item->>'collar_padding', '')::collar_padding,
      v_item->>'additions', v_item->>'embroidery',
      COALESCE(v_item->'measurements', '{}'::jsonb)
    );
  END LOOP;

  INSERT INTO public.order_history (
    tenant_id, order_id, status, notes, updated_by_staff, updated_by_name, updated_at
  ) VALUES (
    v_tenant, v_order_id, (p_order->>'status')::order_status,
    'إنشاء الطلب عبر نقطة البيع', v_staff, COALESCE(v_staff_name, 'System'),
    (p_order->>'order_date')::timestamptz
  );

  INSERT INTO public.tax_invoices (
    tenant_id, order_id, invoice_number, customer_id, customer_name,
    subtotal, tax_rate, tax_amount, discount_amount, paid_amount, total_amount,
    vat_number, qr_payload, issued_at, created_at, status, notes
  ) VALUES (
    v_tenant, v_order_id, p_invoice->>'invoice_number',
    NULLIF(p_order->>'customer_id', '')::uuid, p_order->>'customer_name',
    (p_invoice->>'subtotal')::numeric, (p_order->>'tax_rate')::numeric,
    (p_order->>'tax_amount')::numeric, (p_order->>'discount_amount')::numeric,
    (p_order->>'paid_amount')::numeric, (p_order->>'total_amount')::numeric,
    NULLIF(p_invoice->>'vat_number', ''), p_order->>'qr_code',
    (p_order->>'order_date')::timestamptz, (p_order->>'order_date')::timestamptz,
    'issued', p_invoice->>'notes'
  );

  INSERT INTO public.employee_activity_logs (
    tenant_id, staff_id, staff_name, action, details, occurred_at
  ) VALUES (
    v_tenant, v_staff, COALESCE(v_staff_name, 'System'), 'create_invoice',
    'تم إنشاء فاتورة جديدة بقيمة ' || (p_order->>'total_amount') || ' للعميل ' || (p_order->>'customer_name'),
    now()
  );

  IF v_branch IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      IF (v_item->>'type') = 'ready_made' AND NULLIF(v_item->>'item_id', '') IS NOT NULL THEN
        PERFORM public.apply_stock_movement(
          v_op_key || ':item:' || (v_item->>'item_id'),
          v_branch, (v_item->>'item_id')::uuid,
          -abs((v_item->>'quantity')::numeric), 'sale', v_order_id, 'pos_sale'
        );
      ELSIF (v_item->>'type') = 'custom'
            AND NULLIF(v_item->>'fabric_id', '') IS NOT NULL
            AND (v_item->>'fabric_id') <> 'custom'
            AND NULLIF(v_item->>'consumed_meters', '') IS NOT NULL THEN
        PERFORM public.apply_stock_movement(
          v_op_key || ':fabric:' || (v_item->>'fabric_id'),
          v_branch, (v_item->>'fabric_id')::uuid,
          -abs((v_item->>'consumed_meters')::numeric), 'sale', v_order_id, 'pos_sale'
        );
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'pos_sale', jsonb_build_object('order_id', v_order_id));

  RETURN jsonb_build_object('order_id', v_order_id, 'replayed', false);
END $$;

REVOKE EXECUTE ON FUNCTION public.create_pos_sale(UUID,JSONB,JSONB,JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_pos_sale(UUID,JSONB,JSONB,JSONB) TO authenticated;
