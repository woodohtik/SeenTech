-- Security audit 2026-10-25, fingerprint
-- create_pos_sale.process_sales_return.unvalidated_client_totals (high):
-- both RPCs wrote header-level monetary totals (orders.total_amount/
-- paid_amount/tax_amount/discount_amount, tax_invoices.subtotal/total_amount,
-- sales_returns.total_amount/refunded_amount) straight from client-supplied
-- JSON, with no SUM over the actual line items to cross-check against. The
-- stock-side quantity was always computed correctly and independently of
-- the money side, so a staff session could record real items/quantities
-- (stock moves correctly, sale/return looks legitimate) against a
-- fabricated low sale total (revenue skimming) or inflated refund amount
-- (return fraud) -- and for B2B tenants, the fabricated tax_invoices total
-- later gets signed and submitted as a real ZATCA e-invoice.
--
-- This migration re-publishes both functions (full bodies, unchanged from
-- their last live definitions -- 20261013040000 for create_pos_sale,
-- 20261018000000 for process_sales_return) with one added guard each: the
-- client-supplied subtotal/refunded_amount must match a server-computed
-- SUM over the actual line items within a small rounding tolerance, or the
-- call is rejected before any row is written. This is deliberately a new
-- migration rather than an edit to the two files above -- Supabase tracks
-- applied migrations by filename/version, so editing an already-applied
-- file's content would never reach a database that already recorded that
-- version as applied.

CREATE OR REPLACE FUNCTION public.create_pos_sale(
  p_operation_id UUID,
  p_order        JSONB,
  p_items        JSONB,
  p_invoice      JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant            uuid;
  v_staff             uuid;
  v_staff_name        text;
  v_branch            uuid;
  v_order_id          uuid := p_operation_id;
  v_tracking_token    uuid;
  v_op_key            text;
  v_existing          jsonb;
  v_item              jsonb;
  v_item_id           uuid;
  v_variant_id        uuid;
  v_conflicts         int := 0;
  v_prev_hash         text;
  v_invoice_hash      text;
  v_computed_subtotal numeric;
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

  -- Security audit 2026-10-25: recompute the subtotal from the real line
  -- items and reject a mismatched client-supplied subtotal before any row
  -- is written.
  SELECT COALESCE(SUM(
    COALESCE((i->>'price')::numeric, 0) * COALESCE((i->>'quantity')::numeric, 0)
  ), 0)
    INTO v_computed_subtotal
    FROM jsonb_array_elements(p_items) i;

  IF abs(v_computed_subtotal - COALESCE((p_invoice->>'subtotal')::numeric, 0)) > 0.05 THEN
    RAISE EXCEPTION 'الإجمالي الفرعي المُرسَل (%) لا يطابق مجموع الأصناف الفعلي (%)',
      (p_invoice->>'subtotal')::numeric, v_computed_subtotal
      USING ERRCODE = '22023';
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
  )
  RETURNING tracking_token INTO v_tracking_token;

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

  -- PIH chain: lock (or create) this tenant's chain-tip row first so no
  -- concurrent sale for the same tenant can read the same parent hash.
  INSERT INTO public.zatca_invoice_chain_state (tenant_id)
  VALUES (v_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT last_invoice_hash INTO v_prev_hash
    FROM public.zatca_invoice_chain_state
   WHERE tenant_id = v_tenant
   FOR UPDATE;

  -- extensions.digest -- see 20260917020000's header comment.
  v_invoice_hash := encode(
    extensions.digest(
      COALESCE(v_prev_hash, '') || '|' || v_tenant::text || '|' ||
      (p_invoice->>'invoice_number') || '|' || (p_order->>'total_amount') || '|' ||
      (p_order->>'tax_amount') || '|' || (p_order->>'order_date'),
      'sha256'
    ),
    'base64'
  );

  UPDATE public.zatca_invoice_chain_state
     SET last_invoice_hash = v_invoice_hash, last_invoice_id = v_order_id, updated_at = now()
   WHERE tenant_id = v_tenant;

  INSERT INTO public.tax_invoices (
    tenant_id, order_id, invoice_number, customer_id, customer_name,
    subtotal, tax_rate, tax_amount, discount_amount, paid_amount, total_amount,
    vat_number, qr_payload, issued_at, created_at, status, notes,
    invoice_hash, previous_invoice_hash
  ) VALUES (
    v_tenant, v_order_id, p_invoice->>'invoice_number',
    NULLIF(p_order->>'customer_id', '')::uuid, p_order->>'customer_name',
    (p_invoice->>'subtotal')::numeric, (p_order->>'tax_rate')::numeric,
    (p_order->>'tax_amount')::numeric, (p_order->>'discount_amount')::numeric,
    (p_order->>'paid_amount')::numeric, (p_order->>'total_amount')::numeric,
    NULLIF(p_invoice->>'vat_number', ''), p_order->>'qr_code',
    (p_order->>'order_date')::timestamptz, (p_order->>'order_date')::timestamptz,
    'issued', p_invoice->>'notes',
    v_invoice_hash, v_prev_hash
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
        v_item_id := (v_item->>'item_id')::uuid;
        v_variant_id := NULLIF(v_item->>'variant_id', '')::uuid;
        BEGIN
          PERFORM public.apply_stock_movement(
            v_op_key || ':item:' || (v_item->>'item_id') || COALESCE(':variant:' || (v_item->>'variant_id'), ''),
            v_branch, v_item_id,
            -abs((v_item->>'quantity')::numeric), 'sale', v_order_id, 'pos_sale',
            v_variant_id
          );
        EXCEPTION WHEN SQLSTATE '23514' THEN
          v_conflicts := v_conflicts + 1;
          UPDATE public.order_items
             SET stock_conflict = true, stock_conflict_reason = SQLERRM
           WHERE order_id = v_order_id AND item_id = v_item_id
             AND variant_id IS NOT DISTINCT FROM v_variant_id AND tenant_id = v_tenant;
        END;
      ELSIF (v_item->>'type') = 'custom'
            AND NULLIF(v_item->>'fabric_id', '') IS NOT NULL
            AND (v_item->>'fabric_id') <> 'custom'
            AND NULLIF(v_item->>'consumed_meters', '') IS NOT NULL THEN
        v_item_id := (v_item->>'fabric_id')::uuid;
        BEGIN
          PERFORM public.apply_stock_movement(
            v_op_key || ':fabric:' || (v_item->>'fabric_id'),
            v_branch, v_item_id,
            -abs((v_item->>'consumed_meters')::numeric), 'sale', v_order_id, 'pos_sale'
          );
        EXCEPTION WHEN SQLSTATE '23514' THEN
          v_conflicts := v_conflicts + 1;
          UPDATE public.order_items
             SET stock_conflict = true, stock_conflict_reason = SQLERRM
           WHERE order_id = v_order_id AND fabric_id = v_item_id AND tenant_id = v_tenant;
        END;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'pos_sale',
          jsonb_build_object('order_id', v_order_id, 'stock_conflicts', v_conflicts, 'tracking_token', v_tracking_token));

  RETURN jsonb_build_object('order_id', v_order_id, 'stock_conflicts', v_conflicts, 'replayed', false, 'tracking_token', v_tracking_token);
END $$;

REVOKE EXECUTE ON FUNCTION public.create_pos_sale(UUID,JSONB,JSONB,JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_pos_sale(UUID,JSONB,JSONB,JSONB) TO authenticated;


CREATE OR REPLACE FUNCTION public.process_sales_return(
  p_operation_id UUID,
  p_return       JSONB,
  p_items        JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant            uuid;
  v_staff             uuid;
  v_staff_name        text;
  v_return_id         uuid := p_operation_id;
  v_op_key            text;
  v_existing          jsonb;
  v_item              jsonb;
  v_branch_id         uuid;
  v_item_id           uuid;
  v_order_id          uuid;
  v_order_tenant      uuid;
  v_order_has_custom  boolean;
  v_computed_total    numeric;
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

  -- Security audit 2026-10-25: recompute the return total from the real
  -- line items and reject a client-supplied total_amount/refunded_amount
  -- that exceeds it beyond a small rounding tolerance -- the asymmetric
  -- fraud risk here is an INFLATED refund, not an understated one, so this
  -- rejects totals that are too HIGH relative to the real items.
  SELECT COALESCE(SUM(
    COALESCE((i->>'price')::numeric, 0) * COALESCE((i->>'quantity')::numeric, 0)
  ), 0)
    INTO v_computed_total
    FROM jsonb_array_elements(p_items) i;

  IF COALESCE((p_return->>'total_amount')::numeric, 0) > v_computed_total + 0.05
     OR COALESCE((p_return->>'refunded_amount')::numeric, 0) > v_computed_total + 0.05 THEN
    RAISE EXCEPTION 'مبلغ المرتجع المُرسَل يتجاوز قيمة الأصناف الفعلية (%)', v_computed_total
      USING ERRCODE = '22023';
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
