-- seen-cto-code-review-2026-11-13.md, سبرنت 1، البند 2 (C6 / POS-02 / POS-11).
-- Read cto-review-2026-11-13/07-pos-sales.md's full POS-02/POS-11 entries
-- first.
--
-- process_sales_return trusted the client for everything: item prices
-- (self-referential cross-check only), that an order_item_id actually
-- belonged to the order being returned, that the returned quantity never
-- exceeded what was actually sold minus what was already returned, the
-- variant_id to restock to, and whether the caller was even allowed to
-- process a refund at all (no permission/role check existed). On top of
-- that, SalesRecord.tsx/SalesReturns.tsx never loaded order_items at all
-- (a separate, client-side bug, fixed alongside this one), so in practice
-- every return request this RPC ever received had p_items=[] -- which made
-- it cancel the WHOLE order (discarding custom items still in progress),
-- refund 0, restock nothing, and then the one-return-per-order unique
-- index blocked any correct retry.
--
-- Fix:
-- - p_items now carries only {order_item_id, quantity} -- no price, no
--   item_id, no branch_id. Every one of those is read from the order_items
--   row itself (and the order's own branch_id/shift requirement), so the
--   client cannot misstate what was actually sold.
-- - Returnable quantity is checked against what was actually sold minus
--   what has already been returned across ALL prior returns/credit notes
--   on that line (not a one-shot "already fully returned" index) -- this
--   is what actually fixes "can't retry a return correctly": dropping
--   sales_returns_order_id_unique_full_return in favour of this per-line
--   running total, same idempotency pattern create_pos_sale already uses
--   (operation_id + stock_operations) stays as the real duplicate-submit
--   guard.
-- - Refund amount is derived from the order's own stored totals (same
--   discount ratio the sale itself applied, so a discounted sale refunds
--   proportionally, not at full face value) and capped at
--   paid_amount - already_refunded, never at total_amount alone (the
--   existing check_sales_return_total trigger already bounds against
--   total_amount; it says nothing about what was actually paid on a
--   partial/credit sale, which is the asymmetric fraud risk here).
-- - Requires the caller's own open shift (same requirement create_pos_sale
--   now has) and derives branch_id from the order's own branch, never a
--   client-supplied one; restocks the correct variant_id.
-- - Requires owner/admin/manager (a conservative role-based stand-in for
--   the review's "gate with action.refund" -- full custom-role JSONB
--   permission checking inside this RPC is a further enhancement, not
--   part of this fix).
-- - No longer auto-cancels the order as a side effect of any return. The
--   previous "cancel unless it still has custom items" heuristic was
--   itself fragile (client-told, not server-verified) and conflates two
--   different actions; cancelling an order is now a separate, explicit
--   action outside this RPC, not a guess made inside a refund call.
--
-- NOT in scope here (separate, larger items):
-- - A real ZATCA credit note (XAdES-signed, submitted) for this return --
--   that is C12's rebuild, not this fix.
-- - Unifying this flow with the separate CreditNotes.tsx screen (POS-11
--   notes they are two parallel return paths today) -- a product decision,
--   not touched here.

ALTER TABLE public.sales_returns ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL;

-- Replaces the one-return-per-order partial unique index: idempotency is
-- already guaranteed by operation_id/stock_operations (the exact same
-- mechanism create_pos_sale relies on), and returnable quantity is now
-- checked per order_item_id against the real running total across all
-- prior returns, which correctly allows legitimate separate partial
-- returns over time instead of blocking every retry after the first one.
DROP INDEX IF EXISTS public.sales_returns_order_id_unique_full_return;

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
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager') THEN
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

-- The old 3-arg signature is superseded -- drop it so the client can never
-- accidentally call the unsafe version again (Supabase resolves overloaded
-- RPC names by argument count/types; leaving both would be a live footgun).
DROP FUNCTION IF EXISTS public.process_sales_return(UUID, JSONB, JSONB);
