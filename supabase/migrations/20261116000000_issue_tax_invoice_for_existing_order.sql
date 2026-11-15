-- Bug report (2026-11-16): settling a customer's remaining debt from POS,
-- and viewing "the invoice" from the Orders screen, both show a plain
-- payment-confirmation receipt instead of the real tax invoice -- "كأني
-- اسوي اتمام الدفع في شراء جديد" (like finishing payment on a brand-new
-- purchase). Root cause, confirmed by reading the code, not guessed:
--
-- Only create_pos_sale (an actual POS checkout) ever inserts a row into
-- tax_invoices. An order created directly in "الطلبات" (Orders.tsx's own
-- custom/tailoring order form -- a plain client-side INSERT into
-- `orders`, no RPC) never gets one at all, at creation or at any point
-- afterward -- paying off its balance later (POS's debt-settlement screen
-- or Orders.tsx's own payment modal) only ever touches orders.paid_amount
-- and tax_invoices.paid_amount (syncTaxInvoicePaidAmount, a no-op when no
-- row exists yet). taxInvoiceService.ts's own fetchTaxInvoiceForOrder
-- already documents this exact gap ("Returns null if the order has no tax
-- invoice at all"), and both call sites already have a fallback for
-- exactly this case:
-- - POS.tsx handleViewOrderInvoice -> setFallbackReceipt(...) when
--   fetchTaxInvoiceForOrder returns null.
-- - Orders.tsx handleViewInvoice -> setShowOrderSummaryFallback(true).
-- Both fallbacks print ar.json's measurements.no_invoice_fallback_notice:
-- "هذا الطلب لم يُفوَتر عبر نقطة البيع، فلا توجد له فاتورة ضريبية أصلية" --
-- the exact message reported. TaxInvoiceModal.tsx itself already renders
-- the correct document once given a real invoice row (StandardTaxInvoice
-- for isB2B, SimplifiedTaxInvoice otherwise) -- nothing wrong there; it is
-- simply never reached because the row never existed.
--
-- Fix: issue_tax_invoice_for_order(p_operation_id, p_order_id) -- an
-- atomic, idempotent RPC that creates a real tax_invoices row for an
-- EXISTING order that doesn't have one yet, built from that order's own
-- already-stored total_amount/tax_amount/discount_amount/paid_amount (the
-- same columns close_shift and record_order_payment already treat as
-- authoritative), continuing the same per-tenant sequential invoice
-- numbering and ZATCA hash chain create_pos_sale uses -- so a late-issued
-- invoice is indistinguishable from one issued at POS checkout time, not
-- a separate, lesser document. taxInvoiceService.fetchTaxInvoiceForOrder
-- (the one function both POS.tsx and Orders.tsx already call) is updated
-- to call this RPC first, then fetch as before -- fixing both screens
-- through the one shared function, no component changes needed, and the
-- "no original invoice" fallback branch now only fires for an order that
-- is genuinely cancelled (the one case an invoice should not be
-- backfilled for).

-- Invoice-number-only allocator: allocate_tenant_sale_numbers always
-- advances BOTH order_number and invoice_number together (right, when a
-- sale and its invoice are created in the same breath) -- here the order
-- already has its own order_number, so bumping it again would burn an
-- order_number no order will ever use, opening a gap in that sequence for
-- no reason.
CREATE OR REPLACE FUNCTION public.allocate_tenant_invoice_number(p_tenant UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_num bigint;
BEGIN
  INSERT INTO public.tenant_order_counters (tenant_id)
  VALUES (p_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE public.tenant_order_counters
     SET next_invoice_number = next_invoice_number + 1
   WHERE tenant_id = p_tenant
  RETURNING next_invoice_number - 1 INTO v_num;

  RETURN v_num;
END $$;

REVOKE EXECUTE ON FUNCTION public.allocate_tenant_invoice_number(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_tax_invoice_for_order(
  p_operation_id UUID,
  p_order_id     UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant              uuid;
  v_staff               uuid;
  v_op_key              text;
  v_existing            jsonb;

  v_invoice_id          uuid;
  v_existing_number     text;

  v_order               RECORD;
  v_seller_name         text;
  v_seller_trn          text;
  v_tax_enabled         boolean;

  v_subtotal            numeric;
  v_invoice_number      bigint;
  v_invoice_number_str  text;
  v_prev_hash           text;
  v_invoice_hash        text;
  v_qr_code             text;
  v_now                 timestamptz := now();
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار إصدار الفاتورة' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'issue_tax_invoice_for_order:' || p_operation_id::text;
  SELECT result INTO v_existing FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  -- Idempotent on the order itself, not just the operation_id: a real
  -- invoice may already exist (created by create_pos_sale, or by an
  -- earlier call to this same function from a previous "view invoice"
  -- click) -- return it rather than creating a second one for the same
  -- order, which the tax_invoices schema itself would reject anyway
  -- (no explicit unique constraint on order_id, but it must never happen).
  SELECT id, invoice_number INTO v_invoice_id, v_existing_number
    FROM public.tax_invoices WHERE tenant_id = v_tenant AND order_id = p_order_id;
  IF v_invoice_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'invoice_id', v_invoice_id, 'invoice_number', v_existing_number,
      'already_existed', true, 'replayed', false
    );
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

  v_staff := public.app_current_staff_id();

  SELECT is_tax_enabled, name, vat_number INTO v_tax_enabled, v_seller_name, v_seller_trn
    FROM public.tenants WHERE id = v_tenant;
  v_tax_enabled := COALESCE(v_tax_enabled, false);

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
    vat_number, qr_payload, issued_at, created_at, status,
    invoice_hash, previous_invoice_hash
  ) VALUES (
    v_tenant, p_order_id, v_invoice_number_str, v_order.customer_id, v_order.customer_name,
    v_subtotal, v_order.tax_rate, v_order.tax_amount, v_order.discount_amount,
    v_order.paid_amount, v_order.total_amount,
    NULL, v_qr_code, v_now, v_now, 'issued',
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
