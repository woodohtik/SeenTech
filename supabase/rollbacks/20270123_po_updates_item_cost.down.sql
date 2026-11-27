-- Rollback of 20270123000003_po_updates_item_cost.sql: both functions as they
-- were. The column stays (harmless, default false).
CREATE OR REPLACE FUNCTION public.create_purchase_order(p_operation_id uuid, p_header jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    uuid;
  v_staff     uuid;
  v_po_id     uuid := p_operation_id;
  v_op_key    text;
  v_existing  jsonb;
  v_item      jsonb;
  v_total     numeric := 0;
  v_prefix    text;
  v_number    text;
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

  -- The shop's own sequence (seen-merchant-trial-test-2026-11-26.md, phase 3
  -- item 5): PO-0001, PO-0002 ...; a purchase return (RET-) counts on its own.
  -- The number the browser sends is only read for which of the two it is.
  v_prefix := CASE WHEN upper(COALESCE(p_header->>'po_number', '')) LIKE 'RET%' THEN 'RET' ELSE 'PO' END;
  v_number := v_prefix || '-' || lpad(public.next_document_number(v_tenant, 'purchase_order:' || v_prefix)::text, 4, '0');

  INSERT INTO public.purchase_orders (
    id, tenant_id, branch_id, supplier_id, po_number, total_amount,
    paid_amount, status, order_date, notes, created_by, created_at, updated_at
  ) VALUES (
    v_po_id, v_tenant,
    NULLIF(p_header->>'branch_id', '')::uuid,
    (p_header->>'supplier_id')::uuid,
    v_number,
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
          jsonb_build_object('purchase_order_id', v_po_id, 'total_amount', v_total, 'po_number', v_number));

  RETURN jsonb_build_object('purchase_order_id', v_po_id, 'total_amount', v_total, 'po_number', v_number, 'replayed', false);
END $function$;


CREATE OR REPLACE FUNCTION public.confirm_purchase_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- S-14: confirming a purchase moves stock: suppliers and purchasing only.
  IF NOT coalesce(app_has_permission('suppliers.manage'), false) THEN
    RAISE EXCEPTION 'لا تملك صلاحية اعتماد سندات الشراء' USING ERRCODE = '42501';
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
END $function$;

