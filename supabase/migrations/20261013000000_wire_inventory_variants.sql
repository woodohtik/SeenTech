-- seen-ux-fixes-batch-task.md item 10 -- wiring the product-variants concept
-- that has existed, unused, in the schema since the very first migration
-- (inventory_variants table + variant_id columns on branch_inventory/
-- stock_ledger/order_items, 20240601000000_track_base_schema.sql). No new
-- tables here -- just extending the two existing stock-movement RPCs to
-- accept an optional variant_id, fully backward compatible: every existing
-- caller (direct adjustInventory, record_uom_conversion, transfer_ship_item,
-- transfer_receive_item) keeps calling these positionally without the new
-- trailing parameter, which defaults to NULL and preserves today's exact
-- behavior (a plain, non-variant stock row).

-- Postgres does NOT treat "CREATE OR REPLACE" + a new trailing DEFAULT
-- parameter as replacing the existing function in place -- it registers a
-- second, separate overload instead (confirmed live on staging: querying
-- pg_proc afterward showed both the old 7-arg and new 8-arg signatures
-- coexisting). That risks PostgREST failing to pick a candidate when a
-- caller's named-JSON RPC body is a valid subset of both overloads'
-- parameters. Drop the old signature explicitly first so exactly one
-- function remains -- every existing positional caller (transfer_ship_item/
-- transfer_receive_item below, 7 positional args) still resolves correctly
-- against the new 8-arg function via its own trailing default.
DROP FUNCTION IF EXISTS public.apply_stock_movement(TEXT,UUID,UUID,NUMERIC,TEXT,UUID,TEXT);

CREATE OR REPLACE FUNCTION public.apply_stock_movement(
  p_operation_id   TEXT,
  p_branch_id      UUID,
  p_item_id        UUID,
  p_delta          NUMERIC,
  p_type           TEXT,
  p_reference_id   UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_variant_id     UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant   uuid;
  v_staff    uuid;
  v_prev     numeric;
  v_new      numeric;
  v_existing jsonb;
  v_delta    numeric;
BEGIN
  IF p_operation_id IS NULL OR btrim(p_operation_id) = '' THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار الحركة' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT result INTO v_existing
    FROM public.stock_operations
   WHERE operation_id = p_operation_id AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_delta := round(COALESCE(p_delta, 0)::numeric, 4);
  IF v_delta = 0 THEN
    RAISE EXCEPTION 'لا يوجد تغيير في الكمية' USING ERRCODE = '22023';
  END IF;

  v_staff := public.app_current_staff_id();

  SELECT quantity INTO v_prev
    FROM public.branch_inventory
   WHERE tenant_id = v_tenant
     AND branch_id = p_branch_id
     AND item_id   = p_item_id
     AND variant_id IS NOT DISTINCT FROM p_variant_id
   FOR UPDATE;

  IF v_prev IS NULL THEN
    IF v_delta < 0 THEN
      RAISE EXCEPTION 'لا يوجد رصيد لهذا الصنف في هذا الفرع' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, variant_id, quantity)
    VALUES (v_tenant, p_branch_id, p_item_id, p_variant_id, 0)
    ON CONFLICT DO NOTHING;

    SELECT quantity INTO v_prev
      FROM public.branch_inventory
     WHERE tenant_id = v_tenant AND branch_id = p_branch_id
       AND item_id = p_item_id AND variant_id IS NOT DISTINCT FROM p_variant_id
     FOR UPDATE;
    v_prev := COALESCE(v_prev, 0);
  END IF;

  v_new := round(v_prev + v_delta, 4);

  IF v_new < 0 THEN
    RAISE EXCEPTION 'الكمية المطلوبة غير متوفرة في المخزون (المتاح %، المطلوب %)',
      v_prev, abs(v_delta) USING ERRCODE = '23514';
  END IF;

  UPDATE public.branch_inventory
     SET quantity = v_new, updated_at = now()
   WHERE tenant_id = v_tenant AND branch_id = p_branch_id
     AND item_id = p_item_id AND variant_id IS NOT DISTINCT FROM p_variant_id;

  INSERT INTO public.stock_ledger (
    tenant_id, branch_id, item_id, variant_id, type,
    previous_quantity, new_quantity, change,
    reference_id, reference_type, staff_id, staff_name
  )
  VALUES (
    v_tenant, p_branch_id, p_item_id, p_variant_id, p_type::stock_movement_type,
    v_prev, v_new, v_delta,
    p_reference_id, p_reference_type, v_staff,
    (SELECT name FROM public.staff WHERE id = v_staff)
  );

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (p_operation_id, v_tenant, p_type,
          jsonb_build_object('previous', v_prev, 'new', v_new, 'change', v_delta));

  RETURN jsonb_build_object(
    'previous', v_prev, 'new', v_new, 'change', v_delta,
    'operation_id', p_operation_id, 'replayed', false
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.apply_stock_movement(TEXT,UUID,UUID,NUMERIC,TEXT,UUID,TEXT,UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.apply_stock_movement(TEXT,UUID,UUID,NUMERIC,TEXT,UUID,TEXT,UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- create_pos_sale: thread variant_id through to order_items and the stock
-- deduction call for ready-made lines. Untouched otherwise.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_pos_sale(
  p_operation_id UUID,
  p_order        JSONB,
  p_items        JSONB,
  p_invoice      JSONB
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
      tenant_id, order_id, type, status, item_id, variant_id, name, garment_type, fabric,
      fabric_id, quantity, selected_unit, consumed_meters, price,
      closure_type, closure_visibility, collar_type, cuff_type, pocket_type,
      chest_style, collar_padding, additions, embroidery, measurements
    ) VALUES (
      v_tenant, v_order_id,
      (v_item->>'type')::order_item_type,
      NULLIF(v_item->>'status', '')::order_status,
      NULLIF(v_item->>'item_id', '')::uuid,
      NULLIF(v_item->>'variant_id', '')::uuid,
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
          v_op_key || ':item:' || (v_item->>'item_id') || COALESCE(':variant:' || (v_item->>'variant_id'), ''),
          v_branch, (v_item->>'item_id')::uuid,
          -abs((v_item->>'quantity')::numeric), 'sale', v_order_id, 'pos_sale',
          NULLIF(v_item->>'variant_id', '')::uuid
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
