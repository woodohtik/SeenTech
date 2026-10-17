-- seen-pos-sale-testing-task.md's scoping pass flagged this while reviewing
-- create_pos_sale's neighbors: SalesReturns.tsx did the exact same kind of
-- disconnected multi-write PurchaseOrders.tsx had before this session fixed
-- it (20261017000000_atomic_purchase_order_create.sql) -- INSERT
-- sales_returns, loop apply_stock_movement + INSERT sales_return_items, then
-- UPDATE orders, all as separate client-side calls with no shared
-- transaction. A failure partway through leaves a 'completed' return row
-- with some items restocked and others not, or the order never flipped to
-- 'cancelled' at all.
--
-- That last step was actually WORSE than non-atomic -- it was broken
-- outright. The client code did:
--   .update({ status: 'cancelled', updated_at: ..., items: ..., history: ... })
-- but orders has no `items` or `history` column (confirmed directly against
-- the live schema) -- PostgREST rejects unknown columns, so this update has
-- been failing with a real error on every single full return of a
-- ready-made-only order, right after the return and restock had already
-- gone through. The intent (append a history note) is realized correctly
-- below via order_history, the table this project actually uses for that
-- everywhere else (see create_pos_sale).
--
-- Idempotency note: sales_returns already has a real safety net
-- (sales_returns_order_id_unique_full_return, a partial unique index on
-- order_id for non-"CN-" return numbers) that correctly blocks a second
-- *full* return of the same order. This RPC's own operation_id-based replay
-- cache (same stock_operations pattern as create_pos_sale/
-- create_purchase_order) is a different, narrower guarantee: a retried
-- submission of the exact same request can't double-restock stock or
-- double-write the audit trail. Both protections stay in force together.
CREATE OR REPLACE FUNCTION public.process_sales_return(
  p_operation_id UUID,
  p_return       JSONB,
  p_items        JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant           uuid;
  v_staff            uuid;
  v_staff_name       text;
  v_return_id        uuid := p_operation_id;
  v_op_key           text;
  v_existing         jsonb;
  v_item             jsonb;
  v_branch_id        uuid;
  v_item_id          uuid;
  v_order_id         uuid;
  v_order_tenant     uuid;
  v_order_has_custom boolean;
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

  v_order_id := (p_return->>'order_id')::uuid;
  SELECT tenant_id INTO v_order_tenant FROM public.orders WHERE id = v_order_id;
  IF v_order_tenant IS NULL OR v_order_tenant <> v_tenant THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;

  INSERT INTO public.sales_returns (
    id, tenant_id, invoice_id, order_id, return_number, status, reason,
    total_amount, refunded_amount, refund_method, processed_by, returned_at, created_at
  ) VALUES (
    v_return_id, v_tenant, (p_return->>'invoice_id')::uuid, v_order_id,
    p_return->>'return_number', 'completed', NULLIF(p_return->>'reason', ''),
    (p_return->>'total_amount')::numeric, (p_return->>'refunded_amount')::numeric,
    (p_return->>'refund_method')::payment_method, v_staff, now(), now()
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_branch_id := NULLIF(v_item->>'branch_id', '')::uuid;
    v_item_id := NULLIF(v_item->>'item_id', '')::uuid;

    IF v_branch_id IS NOT NULL AND v_item_id IS NOT NULL THEN
      PERFORM public.apply_stock_movement(
        v_op_key || ':item:' || v_item_id::text,
        v_branch_id, v_item_id,
        abs((v_item->>'quantity')::numeric), 'addition', v_return_id, 'sales_return'
      );
    END IF;

    INSERT INTO public.sales_return_items (
      id, tenant_id, return_id, order_item_id, item_id, name, quantity, unit_price, total
    ) VALUES (
      gen_random_uuid(), v_tenant, v_return_id, NULLIF(v_item->>'order_item_id', '')::uuid,
      v_item_id, v_item->>'name',
      (v_item->>'quantity')::numeric, (v_item->>'price')::numeric,
      (v_item->>'quantity')::numeric * (v_item->>'price')::numeric
    );
  END LOOP;

  -- Only a fully ready-made order (no custom items) is actually "done" once
  -- fully returned -- see the original client-side comment this preserves:
  -- cancelling the whole order when it still has custom items in progress
  -- would silently drop them from their normal workflow despite never being
  -- returned.
  v_order_has_custom := COALESCE((p_return->>'order_has_custom_items')::boolean, false);
  IF NOT v_order_has_custom THEN
    UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = v_order_id;

    INSERT INTO public.order_history (
      tenant_id, order_id, status, notes, updated_by_staff, updated_by_name, updated_at
    ) VALUES (
      v_tenant, v_order_id, 'cancelled', p_return->>'history_note',
      v_staff, COALESCE(v_staff_name, 'System'), now()
    );
  END IF;

  INSERT INTO public.employee_activity_logs (
    tenant_id, staff_id, staff_name, action, details, occurred_at
  ) VALUES (
    v_tenant, v_staff, COALESCE(v_staff_name, 'System'), 'create_sales_return',
    p_return->>'audit_note', now()
  );

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'sales_return',
          jsonb_build_object('return_id', v_return_id, 'return_number', p_return->>'return_number'));

  RETURN jsonb_build_object('return_id', v_return_id, 'return_number', p_return->>'return_number', 'replayed', false);
END $$;

REVOKE EXECUTE ON FUNCTION public.process_sales_return(UUID,JSONB,JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.process_sales_return(UUID,JSONB,JSONB) TO authenticated;
