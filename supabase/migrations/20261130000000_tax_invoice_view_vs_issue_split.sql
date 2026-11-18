-- seen-status-fix-regressions-task.md item 7 (🟠): taxInvoiceService.ts's
-- fetchTaxInvoiceForOrder called issue_tax_invoice_for_order on every
-- "عرض الفاتورة" click, for any non-cancelled order, by any staff member
-- -- a read action silently created a real, ZATCA-hash-chained tax
-- invoice as a side effect. Fixed on the client (same commit) by
-- splitting fetchTaxInvoiceForOrder into a pure read and a separate
-- issueTaxInvoiceForOrder, wired to an explicit "إصدار فاتورة ضريبية"
-- button shown only to owner/admin/manager/accountant on an order that is
-- fully paid or delivered (Orders.tsx's existing no-invoice-yet fallback
-- already degrades gracefully, so no UI regression for anyone else).
--
-- This migration is the defense-in-depth half: the RPC itself must not
-- trust that gating, since any authenticated staff member can still call
-- it directly. Three changes:
--   1. Role check (owner/admin/manager/accountant) and a
--      paid-in-full-or-delivered check on the order, server-side.
--   2. The existing-invoice check moves to AFTER the order's FOR UPDATE
--      lock (it ran before the lock, so two concurrent calls for the
--      same order could both pass it and both insert -- the lock orders
--      them, and the re-check after it is what actually closes the race).
--   3. UNIQUE (order_id) on tax_invoices, so even a future bug in this
--      function (or any other write path) cannot create a second invoice
--      for the same order -- the constraint is the backstop, the
--      application logic above is the UX. A DO block checks staging for
--      any pre-existing duplicate before adding it; this migration
--      refuses to apply (surfacing the problem instead of silently
--      failing the ALTER) if one is found. The founder must still run
--      the equivalent check against production before this migration is
--      ever applied there.
--
-- Also: the buyer's VAT number is now read from customers.vat_number
-- (added 20260817100000, already populated by Customers.tsx's own form)
-- instead of being hardcoded NULL for a late-issued invoice.

DO $$
DECLARE
  v_dupes int;
BEGIN
  SELECT count(*) INTO v_dupes FROM (
    SELECT order_id FROM public.tax_invoices
    WHERE order_id IS NOT NULL
    GROUP BY order_id HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'tax_invoices has % order_id(s) with more than one invoice -- resolve before adding the UNIQUE constraint (see this migration''s header)', v_dupes;
  END IF;
END $$;

ALTER TABLE public.tax_invoices
  ADD CONSTRAINT tax_invoices_order_id_unique UNIQUE (order_id);

CREATE OR REPLACE FUNCTION public.issue_tax_invoice_for_order(
  p_operation_id UUID,
  p_order_id     UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant              uuid;
  v_staff               uuid;
  v_role                text;
  v_op_key              text;
  v_existing            jsonb;

  v_invoice_id          uuid;
  v_existing_number     text;

  v_order               RECORD;
  v_seller_name         text;
  v_seller_trn          text;
  v_buyer_trn           text;
  v_tax_enabled         boolean;

  v_subtotal            numeric;
  v_invoice_number      bigint;
  v_invoice_number_str  text;
  v_prev_hash           text;
  v_invoice_hash        text;
  v_qr_code             text;
  v_items_json          jsonb;
  v_notes               text;
  v_now                 timestamptz := now();
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار إصدار الفاتورة' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_current_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager', 'accountant') THEN
    RAISE EXCEPTION 'إصدار الفاتورة الضريبية يتطلب صلاحية owner أو admin أو manager أو accountant' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'issue_tax_invoice_for_order:' || p_operation_id::text;
  SELECT result INTO v_existing FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO v_order FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'لا يمكن إصدار فاتورة لطلب مُلغى' USING ERRCODE = '22023';
  END IF;

  IF v_order.status <> 'delivered' AND round(COALESCE(v_order.total_amount, 0) - COALESCE(v_order.paid_amount, 0), 2) > 0 THEN
    RAISE EXCEPTION 'لا يمكن إصدار فاتورة لطلب غير مدفوع بالكامل أو غير مُسلَّم' USING ERRCODE = '22023';
  END IF;

  -- Re-checked here, AFTER the order's own FOR UPDATE lock above (not
  -- just once before it): the lock serializes concurrent calls for the
  -- SAME order_id, so this is the check that actually prevents two
  -- concurrent "إصدار" clicks from both inserting an invoice -- the
  -- UNIQUE constraint added by this same migration is the backstop if a
  -- future write path misses this pattern entirely.
  SELECT id, invoice_number INTO v_invoice_id, v_existing_number
    FROM public.tax_invoices WHERE tenant_id = v_tenant AND order_id = p_order_id;
  IF v_invoice_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'invoice_id', v_invoice_id, 'invoice_number', v_existing_number,
      'already_existed', true, 'replayed', false
    );
  END IF;

  v_staff := public.app_current_staff_id();

  SELECT is_tax_enabled, name, vat_number INTO v_tax_enabled, v_seller_name, v_seller_trn
    FROM public.tenants WHERE id = v_tenant;
  v_tax_enabled := COALESCE(v_tax_enabled, false);

  IF v_order.customer_id IS NOT NULL THEN
    SELECT vat_number INTO v_buyer_trn FROM public.customers WHERE id = v_order.customer_id;
  END IF;

  -- Same wall create_pos_sale already enforces: never issue a tax invoice
  -- under a blank/unconfigured seller identity.
  IF v_tax_enabled AND (COALESCE(v_seller_name, '') = '' OR COALESCE(v_seller_trn, '') = '') THEN
    RAISE EXCEPTION 'أكمل الاسم التجاري والرقم الضريبي في الإعدادات قبل إصدار أي فاتورة'
      USING ERRCODE = '22023';
  END IF;

  -- orders.total_amount/tax_amount are already the authoritative, final
  -- figures for this order (the same columns close_shift and
  -- record_order_payment already treat as such) -- subtotal is simply
  -- backed out of them, the same way create_pos_sale derives it from its
  -- own server-computed total/tax rather than a separately stored value.
  v_subtotal := round(COALESCE(v_order.total_amount, 0) - COALESCE(v_order.tax_amount, 0), 2);

  -- Same items shape POS.tsx's own cart mapping encodes (name, quantity,
  -- price, type) -- built from this order's actual order_items rows so a
  -- late-issued invoice shows the same lines a POS-checkout invoice would.
  SELECT jsonb_agg(jsonb_build_object(
           'name', COALESCE(oi.name, oi.garment_type, 'منتج'),
           'quantity', oi.quantity,
           'price', oi.price,
           'type', oi.type::text
         ) ORDER BY oi.created_at)
    INTO v_items_json
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id AND oi.tenant_id = v_tenant;

  v_notes := '__INVOICE_EXT_METADATA__:' || jsonb_build_object(
    'items', COALESCE(v_items_json, '[]'::jsonb),
    'created_by', COALESCE((SELECT name FROM public.staff WHERE id = v_staff), 'Staff')
  )::text;

  v_invoice_number := public.allocate_tenant_invoice_number(v_tenant);
  v_invoice_number_str := 'INV-' || v_invoice_number::text;

  v_qr_code := CASE WHEN v_tax_enabled AND COALESCE(v_seller_trn, '') <> ''
    THEN public.zatca_qr_payload(v_seller_name, v_seller_trn, v_now, v_order.total_amount::text, v_order.tax_amount::text)
    ELSE NULL END;

  INSERT INTO public.zatca_invoice_chain_state (tenant_id)
  VALUES (v_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT last_invoice_hash INTO v_prev_hash
    FROM public.zatca_invoice_chain_state
   WHERE tenant_id = v_tenant
   FOR UPDATE;

  v_invoice_hash := encode(
    extensions.digest(
      COALESCE(v_prev_hash, '') || '|' || v_tenant::text || '|' ||
      v_invoice_number_str || '|' || v_order.total_amount::text || '|' ||
      v_order.tax_amount::text || '|' || v_now::text,
      'sha256'
    ),
    'base64'
  );

  UPDATE public.zatca_invoice_chain_state
     SET last_invoice_hash = v_invoice_hash, last_invoice_id = p_order_id, updated_at = v_now
   WHERE tenant_id = v_tenant;

  INSERT INTO public.tax_invoices (
    tenant_id, order_id, invoice_number, customer_id, customer_name,
    subtotal, tax_rate, tax_amount, discount_amount, paid_amount, total_amount,
    vat_number, qr_payload, issued_at, created_at, status, notes,
    invoice_hash, previous_invoice_hash
  ) VALUES (
    v_tenant, p_order_id, v_invoice_number_str, v_order.customer_id, v_order.customer_name,
    v_subtotal, v_order.tax_rate, v_order.tax_amount, v_order.discount_amount,
    v_order.paid_amount, v_order.total_amount,
    v_buyer_trn, v_qr_code, v_now, v_now, 'issued', v_notes,
    v_invoice_hash, v_prev_hash
  ) RETURNING id INTO v_invoice_id;

  BEGIN
    INSERT INTO public.employee_activity_logs (tenant_id, staff_id, staff_name, action, details, occurred_at)
    VALUES (v_tenant, v_staff, COALESCE((SELECT name FROM public.staff WHERE id = v_staff), 'Staff'), 'create_invoice',
            'إصدار فاتورة متأخرة لطلب موجود رقم ' || COALESCE(v_order.order_number::text, '') ||
              ' بقيمة ' || v_order.total_amount::text, v_now);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'issue_tax_invoice_for_order', jsonb_build_object(
    'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number_str, 'already_existed', false
  ));

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number_str,
    'already_existed', false, 'replayed', false
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.issue_tax_invoice_for_order(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.issue_tax_invoice_for_order(UUID, UUID) TO authenticated;
