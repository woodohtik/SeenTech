-- seen-ux-fixes-batch-task.md item 10 -- purchase orders were deliberately
-- excluded from the product-variants feature (PurchaseOrders.tsx filtered
-- any item with variants out of its item picker, with a "not supported
-- yet" hint) because purchase_order_items had no variant_id at all, unlike
-- branch_inventory/stock_ledger/order_items which all got one in the very
-- first migration. Wiring it up now: a column, plus both PO RPCs threaded
-- through to carry and apply it.

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.inventory_variants(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- create_purchase_order: carry variant_id from each item payload into the row.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_operation_id UUID,
  p_header       JSONB,
  p_items        JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant    uuid;
  v_staff     uuid;
  v_po_id     uuid := p_operation_id;
  v_op_key    text;
  v_existing  jsonb;
  v_item      jsonb;
  v_total     numeric := 0;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار إنشاء السند' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'create_po:' || p_operation_id::text;

  SELECT result INTO v_existing
    FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'لا يمكن إنشاء سند شراء بلا عناصر' USING ERRCODE = '22023';
  END IF;

  v_staff := public.app_current_staff_id();

  SELECT COALESCE(SUM((i->>'total')::numeric), 0) INTO v_total
    FROM jsonb_array_elements(p_items) i;

  INSERT INTO public.purchase_orders (
    id, tenant_id, branch_id, supplier_id, po_number, total_amount,
    paid_amount, status, order_date, notes, created_by, created_at, updated_at
  ) VALUES (
    v_po_id, v_tenant,
    NULLIF(p_header->>'branch_id', '')::uuid,
    (p_header->>'supplier_id')::uuid,
    p_header->>'po_number',
    v_total, 0, 'draft', now(),
    p_header->>'notes', v_staff, now(), now()
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.purchase_order_items (
      tenant_id, purchase_order_id, item_id, variant_id, name, quantity, unit,
      conversion_rate, base_quantity, price_per_unit, total
    ) VALUES (
      v_tenant, v_po_id,
      NULLIF(v_item->>'item_id', '')::uuid,
      NULLIF(v_item->>'variant_id', '')::uuid,
      v_item->>'name',
      (v_item->>'quantity')::numeric,
      (v_item->>'unit')::inventory_unit,
      (v_item->>'conversion_rate')::numeric,
      (v_item->>'base_quantity')::numeric,
      (v_item->>'price_per_unit')::numeric,
      (v_item->>'total')::numeric
    );
  END LOOP;

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'create_purchase_order',
          jsonb_build_object('purchase_order_id', v_po_id, 'total_amount', v_total));

  RETURN jsonb_build_object('purchase_order_id', v_po_id, 'total_amount', v_total, 'replayed', false);
END $$;

REVOKE EXECUTE ON FUNCTION public.create_purchase_order(UUID,JSONB,JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_purchase_order(UUID,JSONB,JSONB) TO authenticated;

-- -----------------------------------------------------------------------------
-- confirm_purchase_order: pass each row's variant_id through to
-- apply_stock_movement, and fold it into the per-item idempotency key so two
-- different variants of the same base item never collide on the same key
-- (mirrors create_pos_sale's own ':variant:' suffix convention).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_purchase_order(
  p_order_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant          uuid;
  v_order           RECORD;
  v_item            RECORD;
  v_order_type      text;
  v_target_status   purchase_order_status;
  v_branch_id       uuid;
  v_item_delta      numeric;
  v_balance_delta   numeric;
  v_new_balance     numeric;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
    FROM public.purchase_orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'سند الشراء غير موجود أو لا ينتمي لهذا المستأجر' USING ERRCODE = '42501';
  END IF;

  IF v_order.status IN ('received', 'returned') THEN
    RETURN jsonb_build_object('purchase_order_id', p_order_id, 'status', v_order.status, 'replayed', true);
  END IF;

  v_order_type    := CASE WHEN v_order.po_number LIKE 'RET%' THEN 'return' ELSE 'purchase' END;
  v_target_status := CASE WHEN v_order_type = 'purchase' THEN 'received' ELSE 'returned' END;

  v_branch_id := v_order.branch_id;
  IF v_branch_id IS NULL THEN
    SELECT id INTO v_branch_id FROM public.branches WHERE tenant_id = v_tenant LIMIT 1;
  END IF;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'لا يوجد فرع لتسجيل حركة المخزون عليه' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT * FROM public.purchase_order_items WHERE purchase_order_id = p_order_id
  LOOP
    CONTINUE WHEN v_item.item_id IS NULL;

    v_item_delta := COALESCE(v_item.base_quantity, v_item.quantity, 0);
    IF v_order_type = 'return' THEN v_item_delta := -v_item_delta; END IF;
    CONTINUE WHEN v_item_delta = 0;

    PERFORM public.apply_stock_movement(
      p_operation_id   => 'po:' || p_order_id::text || ':item:' || v_item.item_id::text
                          || COALESCE(':variant:' || v_item.variant_id::text, ''),
      p_branch_id      => v_branch_id,
      p_item_id        => v_item.item_id,
      p_delta          => v_item_delta,
      p_type           => CASE WHEN v_item_delta > 0 THEN 'addition' ELSE 'deduction' END,
      p_reference_id   => p_order_id,
      p_reference_type => v_order_type,
      p_variant_id     => v_item.variant_id
    );
  END LOOP;

  IF v_order.supplier_id IS NOT NULL AND v_order.total_amount <> 0 THEN
    v_balance_delta := CASE WHEN v_order_type = 'purchase' THEN v_order.total_amount ELSE -v_order.total_amount END;

    v_new_balance := public.increment_supplier_balance(v_order.supplier_id, v_balance_delta, p_order_id);

    INSERT INTO public.supplier_transactions (
      id, tenant_id, supplier_id, type, credit, debit,
      running_balance, reference_number, date, notes
    ) VALUES (
      p_order_id, v_tenant, v_order.supplier_id,
      CASE WHEN v_order_type = 'purchase' THEN 'purchase' ELSE 'adjustment' END,
      CASE WHEN v_order_type = 'purchase' THEN v_order.total_amount ELSE 0 END,
      CASE WHEN v_order_type = 'purchase' THEN 0 ELSE v_order.total_amount END,
      v_new_balance,
      COALESCE(NULLIF(v_order.po_number, ''), 'PO-' || upper(right(p_order_id::text, 6))),
      now(),
      CASE WHEN v_order_type = 'purchase'
        THEN 'شراء بضائع ومواد بموجب أمر الشراء رقم ' || COALESCE(NULLIF(v_order.po_number, ''), upper(right(p_order_id::text, 6)))
        ELSE 'مرتجع بضائع ومواد بموجب سند إرجاع رقم ' || COALESCE(NULLIF(v_order.po_number, ''), upper(right(p_order_id::text, 6)))
      END
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  UPDATE public.purchase_orders
     SET status = v_target_status, received_date = now(), updated_at = now()
   WHERE id = p_order_id;

  RETURN jsonb_build_object('purchase_order_id', p_order_id, 'status', v_target_status, 'replayed', false);
END $$;

REVOKE ALL ON FUNCTION public.confirm_purchase_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_purchase_order(UUID) TO authenticated;
