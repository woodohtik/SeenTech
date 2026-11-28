-- seen-product-variants-barcode-po-price-task.md, phase 4 (questions 3, 4):
-- a purchase order's price can update the product's purchase price.
--
--   * purchase_order_items.update_item_cost: the line's "update the
--     product's price" box (ticked by default in the app when the price was
--     changed).
--   * create_purchase_order (from its snapshot): saves that box. One line
--     changed (the insert's column list and values); none removed.
--   * confirm_purchase_order (from its snapshot): when an order is CONFIRMED
--     (not as a draft), each ticked purchase line sets the product's cost per
--     base unit, inside the same transaction, logged in audit_logs. Never a
--     return; only with inventory.edit (else counted in cost_not_updated).
--     The stock, supplier balance and status steps are unchanged; no line
--     removed.
--
-- The cost lives in inventory_items.description's metadata
-- (__INVENTORY_METADATA__:{"costPrice":...}) -- where every screen reads it
-- (utils/b2bHelper.ts); there is no cost_price column.
--
-- Test: supabase/tests/po_updates_item_cost_test.sql
-- Rollback: supabase/rollbacks/20270123_po_updates_item_cost.down.sql

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS update_item_cost boolean NOT NULL DEFAULT false;

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
      conversion_rate, base_quantity, price_per_unit, total, update_item_cost
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
      (v_item->>'total')::numeric,
      COALESCE((v_item->>'update_item_cost')::boolean, false)
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
  v_cost            numeric;
  v_old_cost        numeric;
  v_desc            text;
  v_meta            jsonb;
  v_can_edit_cost   boolean;
  v_cost_updated    int := 0;
  v_cost_skipped    int := 0;
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

  v_can_edit_cost := coalesce(app_has_permission('inventory.edit'), false);

  FOR v_item IN
    SELECT * FROM public.purchase_order_items WHERE purchase_order_id = p_order_id
  LOOP
    CONTINUE WHEN v_item.item_id IS NULL;

    -- seen-product-variants-barcode-po-price-task.md, phase 4: a purchase
    -- line marked "update the product's price" sets the product's cost --
    -- per base unit (a roll's price / its metres), in the description
    -- metadata where the app keeps it. Never from a return; only with
    -- inventory.edit (otherwise the order still goes through, counted in
    -- cost_not_updated). The selling price is never touched.
    IF v_order_type = 'purchase' AND v_item.update_item_cost THEN
      IF NOT v_can_edit_cost THEN
        v_cost_skipped := v_cost_skipped + 1;
      ELSE
        v_cost := round(v_item.price_per_unit / NULLIF(COALESCE(v_item.conversion_rate, 1), 0), 4);
        SELECT description INTO v_desc FROM public.inventory_items
         WHERE id = v_item.item_id AND tenant_id = v_tenant FOR UPDATE;
        v_meta := NULL;
        IF left(COALESCE(v_desc, ''), 23) = '__INVENTORY_METADATA__:' THEN
          BEGIN
            v_meta := substring(v_desc from 24)::jsonb;
          EXCEPTION WHEN others THEN
            v_meta := NULL;
          END;
        END IF;
        IF v_meta IS NULL THEN
          v_meta := jsonb_build_object('costPrice', 0, 'taxType', 'exclusive', 'originalDescription', COALESCE(v_desc, ''));
        END IF;
        v_old_cost := COALESCE((v_meta ->> 'costPrice')::numeric, 0);
        IF v_cost IS NOT NULL AND v_cost >= 0 AND v_cost <> v_old_cost THEN
          UPDATE public.inventory_items
             SET description = '__INVENTORY_METADATA__:' || jsonb_set(v_meta, '{costPrice}', to_jsonb(v_cost))::text,
                 updated_at = now()
           WHERE id = v_item.item_id AND tenant_id = v_tenant;
          INSERT INTO public.audit_logs (tenant_id, action, type, details, metadata)
          VALUES (v_tenant, 'inventory.cost_from_purchase_order', 'system',
                  'تحديث سعر الشراء من أمر الشراء ' || COALESCE(NULLIF(v_order.po_number, ''), p_order_id::text),
                  jsonb_build_object('item_id', v_item.item_id, 'from', v_old_cost, 'to', v_cost,
                                     'purchase_order_id', p_order_id, 'po_number', v_order.po_number,
                                     'staff_id', public.app_current_staff_id()));
          v_cost_updated := v_cost_updated + 1;
        END IF;
      END IF;
    END IF;

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

  RETURN jsonb_build_object('purchase_order_id', p_order_id, 'status', v_target_status, 'replayed', false,
                            'cost_updated', v_cost_updated, 'cost_not_updated', v_cost_skipped);
END $function$;

