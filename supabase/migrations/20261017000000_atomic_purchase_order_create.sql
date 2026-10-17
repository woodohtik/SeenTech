-- seen-deep-technical-audit.md High #9: PurchaseOrders.tsx's "create order"
-- flow did two disconnected writes from the client -- INSERT purchase_orders,
-- then a second INSERT purchase_order_items -- with no idempotency key and no
-- transaction tying them together. A dropped connection after the header
-- insert left a permanent empty draft PO with no items and no cleanup; a
-- double-submit (double click, or a retried request after a timeout) could
-- create two POs for the same intended submission. This is exactly the class
-- of bug create_pos_sale (20260914000000_atomic_pos_checkout.sql) already
-- fixed for POS checkout -- same fix here: one atomic, idempotent RPC.
--
-- Pattern copied from create_pos_sale: operationId (client-generated UUID)
-- doubles as the new purchase_orders.id, and stock_operations gives replay
-- safety on retry. No stock/ledger/supplier-balance writes happen here --
-- those only happen on confirm (handleConfirmOrder), which already goes
-- through the idempotent apply_stock_movement per item and is unaffected by
-- this migration.
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
      tenant_id, purchase_order_id, item_id, name, quantity, unit,
      conversion_rate, base_quantity, price_per_unit, total
    ) VALUES (
      v_tenant, v_po_id,
      NULLIF(v_item->>'item_id', '')::uuid,
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
