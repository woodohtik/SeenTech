-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Task 2.
--
-- create_pos_sale is the RPC behind every POS checkout and today has NO
-- role check at all on who may collect a payment (any staff with an open
-- shift can sell), and discount amount is only capped numerically by
-- app_max_discount_percent() (role-based cap), never gated as an on/off
-- permission (POS-12). This migration adds exactly two gates, both reading
-- app_has_permission() from Task 1 (20261205000000_app_has_permission.sql):
--
--   1. payments.collect -- checked immediately after v_staff is resolved,
--      so it blocks the whole sale (not just the payment-recording insert
--      further down) when the caller isn't allowed to collect a payment at
--      all.
--   2. action.discount -- checked immediately after v_discount_value is
--      computed, and only when v_discount_value > 0, so a sale with no
--      discount requested (discount_value: 0, the default when the client
--      sends no discount_value at all) is never blocked by this gate even
--      for a staff member whose permission is false.
--
-- The body below is otherwise byte-for-byte identical to
-- 20261204000000_create_pos_sale_catalog_price_any_item_id.sql.
CREATE OR REPLACE FUNCTION public.create_pos_sale(
  p_operation_id UUID,
  p_order        JSONB,
  p_items        JSONB,
  p_invoice      JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant              uuid;
  v_staff               uuid;
  v_staff_name          text;
  v_branch              uuid;
  v_shift               uuid;
  v_order_id            uuid := p_operation_id;
  v_tracking_token      uuid;
  v_op_key              text;
  v_existing            jsonb;
  v_item                jsonb;
  v_item_id             uuid;
  v_variant_id          uuid;
  v_effective_price     numeric;
  v_catalog_price       numeric;
  v_variant_adjustment  numeric;
  v_conflicts           int := 0;
  v_prev_hash           text;
  v_invoice_hash        text;
  v_invoice_id          uuid;

  v_tax_enabled         boolean;
  v_vat_rate_pct        numeric;
  v_tax_fraction        numeric;
  v_seller_name         text;
  v_seller_trn          text;
  v_buyer_trn           text;
  v_qr_code             text;
  v_subtotal_exvat      numeric := 0;
  v_gross_before        numeric;
  v_max_discount_pct    numeric;
  v_discount_type       text;
  v_discount_value      numeric;
  v_discount_gross      numeric;
  v_total_amount        numeric;
  v_discounted_subtotal numeric;
  v_tax_amount          numeric;
  v_discount_amount     numeric;
  v_paid_amount         numeric;

  v_order_number        bigint;
  v_invoice_number      bigint;
  v_invoice_number_str  text;
  v_now                 timestamptz := now();
  v_items_resolved      jsonb := '[]'::jsonb;
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

  -- POS-12 / payments.collect gate: a sale without the ability to collect
  -- payment shouldn't be allowed at all, so this blocks the whole sale up
  -- front rather than only the payment-recording insert further down.
  IF NOT public.app_has_permission('payments.collect') THEN
    RAISE EXCEPTION 'لا تملك صلاحية استلام الدفعات' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;

  -- Require the caller's own open shift (POS-07): no more trusting a
  -- client-supplied branch_id/shift_id, and no more silently skipping
  -- stock deduction when shift_id is NULL. branch_id is derived from the
  -- shift, never from the client.
  v_shift := NULLIF(p_order->>'shift_id', '')::uuid;
  IF v_shift IS NULL THEN
    RAISE EXCEPTION 'لا توجد وردية مفتوحة -- افتح وردية قبل البيع' USING ERRCODE = '22023';
  END IF;

  SELECT id, branch_id INTO v_shift, v_branch
    FROM public.shifts
   WHERE id = v_shift AND tenant_id = v_tenant AND staff_id = v_staff AND status = 'open'
   FOR SHARE;
  IF v_shift IS NULL THEN
    RAISE EXCEPTION 'الوردية المحدَّدة غير مفتوحة أو لا تخصّك' USING ERRCODE = '22023';
  END IF;

  -- Resolve each item's real price from the catalog instead of trusting
  -- the client, and build a resolved items array carrying the
  -- authoritative price so the insert loop below and the totals
  -- computation agree on the exact same number. Gated on item_id being
  -- present and resolvable -- NOT on the client-declared type -- so a
  -- line mislabeled 'custom' while still pointing at a real catalog item
  -- cannot dodge catalog pricing.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF NULLIF(v_item->>'item_id', '') IS NOT NULL THEN
      v_item_id := (v_item->>'item_id')::uuid;
      v_variant_id := NULLIF(v_item->>'variant_id', '')::uuid;

      SELECT price_per_unit INTO v_catalog_price
        FROM public.inventory_items
       WHERE id = v_item_id AND tenant_id = v_tenant;
      IF v_catalog_price IS NULL THEN
        RAISE EXCEPTION 'صنف غير موجود في كتالوج هذا المتجر' USING ERRCODE = '22023';
      END IF;

      v_variant_adjustment := 0;
      IF v_variant_id IS NOT NULL THEN
        SELECT price_adjustment INTO v_variant_adjustment
          FROM public.inventory_variants
         WHERE id = v_variant_id AND item_id = v_item_id AND tenant_id = v_tenant;
        IF v_variant_adjustment IS NULL THEN
          RAISE EXCEPTION 'سمة الصنف غير موجودة' USING ERRCODE = '22023';
        END IF;
      END IF;

      v_effective_price := v_catalog_price + COALESCE(v_variant_adjustment, 0);
    ELSE
      -- true bespoke line: no catalog item_id at all, the tailor's own
      -- quoted price is authoritative, just validated non-negative.
      v_effective_price := GREATEST(COALESCE((v_item->>'price')::numeric, 0), 0);
    END IF;

    v_subtotal_exvat := v_subtotal_exvat
      + ROUND(v_effective_price * COALESCE((v_item->>'quantity')::numeric, 0), 2);

    v_items_resolved := v_items_resolved || jsonb_build_object('item', v_item, 'price', v_effective_price);
  END LOOP;

  -- Pricing engine: single tenant-wide VAT rate (see migration header note
  -- on why there is no real per-item tax type yet). total_amount is
  -- derived by subtracting the (capped) discount from the VAT-inclusive
  -- total directly, so it is exact by construction regardless of
  -- discount type; subtotal/tax are then split back out of that exact
  -- total for display/storage, which can differ from each other by at
  -- most one halala of rounding -- never from the real total charged.
  SELECT is_tax_enabled, default_tax_rate, name, vat_number
    INTO v_tax_enabled, v_vat_rate_pct, v_seller_name, v_seller_trn
    FROM public.tenants WHERE id = v_tenant;
  v_tax_enabled := COALESCE(v_tax_enabled, false);
  v_tax_fraction := CASE WHEN v_tax_enabled THEN COALESCE(v_vat_rate_pct, 15) / 100 ELSE 0 END;
  v_gross_before := ROUND(v_subtotal_exvat * (1 + v_tax_fraction), 2);

  v_buyer_trn := NULLIF(p_invoice->>'vat_number', '');

  -- ZATCA Phase 0 (already enforced client-side): a tax invoice may never
  -- be issued under a blank/fabricated seller identity. Re-enforced here
  -- server-side now that the client is no longer the one deciding whether
  -- an invoice is needed -- a cashier bypassing the UI must hit the same
  -- wall, not a different, looser one.
  IF (v_tax_enabled OR v_buyer_trn IS NOT NULL)
     AND (COALESCE(v_seller_name, '') = '' OR COALESCE(v_seller_trn, '') = '') THEN
    RAISE EXCEPTION 'أكمل الاسم التجاري والرقم الضريبي في الإعدادات قبل إصدار أي فاتورة'
      USING ERRCODE = '22023';
  END IF;

  v_max_discount_pct := public.app_max_discount_percent();
  v_discount_type := COALESCE(p_invoice->>'discount_type', 'percent');
  v_discount_value := GREATEST(COALESCE((p_invoice->>'discount_value')::numeric, 0), 0);

  -- POS-12 / action.discount gate: only a requested discount (value > 0)
  -- is gated -- discount_value: 0 (no discount requested) must never be
  -- blocked even when this staff member's action.discount is false.
  IF v_discount_value > 0 AND NOT public.app_has_permission('action.discount') THEN
    RAISE EXCEPTION 'لا تملك صلاحية منح خصم' USING ERRCODE = '42501';
  END IF;

  IF v_discount_type = 'fixed' THEN
    -- Founder decision: a fixed discount amount is VAT-inclusive -- "10
    -- SAR off" reduces the customer's final total by exactly 10 SAR.
    v_discount_gross := LEAST(v_discount_value, v_gross_before);
  ELSE
    v_discount_gross := ROUND(v_gross_before * LEAST(v_discount_value, 100) / 100, 2);
  END IF;

  IF v_max_discount_pct IS NOT NULL THEN
    v_discount_gross := LEAST(v_discount_gross, ROUND(v_gross_before * v_max_discount_pct / 100, 2));
  END IF;

  v_total_amount := v_gross_before - v_discount_gross;
  IF v_tax_enabled THEN
    v_discounted_subtotal := ROUND(v_total_amount / (1 + v_tax_fraction), 2);
  ELSE
    v_discounted_subtotal := v_total_amount;
  END IF;
  v_tax_amount := v_total_amount - v_discounted_subtotal;
  v_discount_amount := v_subtotal_exvat - v_discounted_subtotal;

  v_paid_amount := COALESCE((p_order->>'paid_amount')::numeric, 0);
  IF v_paid_amount > v_total_amount THEN
    RAISE EXCEPTION 'المبلغ المدفوع (%) أكبر من إجمالي الفاتورة (%)', v_paid_amount, v_total_amount
      USING ERRCODE = '22023';
  END IF;

  SELECT order_number, invoice_number INTO v_order_number, v_invoice_number
    FROM public.allocate_tenant_sale_numbers(v_tenant);
  v_invoice_number_str := 'INV-' || v_invoice_number::text;

  -- QR must be built from the real, server-computed total/tax -- computing
  -- it from client numbers before this point would be exactly the "browser
  -- is the source of truth" problem this whole migration closes.
  v_qr_code := CASE WHEN (v_tax_enabled OR v_buyer_trn IS NOT NULL)
    THEN public.zatca_qr_payload(v_seller_name, v_seller_trn, v_now, v_total_amount::text, v_tax_amount::text)
    ELSE NULL
  END;

  INSERT INTO public.orders (
    id, tenant_id, branch_id, shift_id, customer_id, customer_name,
    order_number, status, payment_method, total_amount, paid_amount,
    tax_rate, tax_amount, discount_amount, order_date, delivery_date,
    qr_code, notes, created_by, created_at
  ) VALUES (
    v_order_id, v_tenant, v_branch, v_shift,
    NULLIF(p_order->>'customer_id', '')::uuid,
    p_order->>'customer_name',
    v_order_number,
    (p_order->>'status')::order_status,
    (p_order->>'payment_method')::payment_method,
    v_total_amount, v_paid_amount,
    v_tax_fraction, v_tax_amount, v_discount_amount,
    v_now, (p_order->>'delivery_date')::timestamptz,
    v_qr_code, p_order->>'notes',
    v_staff, v_now
  )
  RETURNING tracking_token INTO v_tracking_token;

  FOR v_item, v_effective_price IN
    SELECT item, price FROM jsonb_to_recordset(v_items_resolved) AS x(item jsonb, price numeric)
  LOOP
    INSERT INTO public.order_items (
      tenant_id, order_id, type, status, item_id, variant_id, name, garment_type, fabric,
      fabric_id, quantity, selected_unit, consumed_meters, price,
      closure_type, closure_visibility, collar_type, cuff_type, pocket_type,
      chest_style, shoulder_style, cutting_type, collar_padding, additions, embroidery, measurements
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
      v_effective_price,
      NULLIF(v_item->>'closure_type', '')::closure_type,
      NULLIF(v_item->>'closure_visibility', '')::closure_visibility,
      v_item->>'collar_type', v_item->>'cuff_type', v_item->>'pocket_type',
      v_item->>'chest_style', v_item->>'shoulder_style', v_item->>'cutting_type',
      NULLIF(v_item->>'collar_padding', '')::collar_padding,
      v_item->>'additions', v_item->>'embroidery',
      COALESCE(v_item->'measurements', '{}'::jsonb)
    );
  END LOOP;

  INSERT INTO public.order_history (
    tenant_id, order_id, status, notes, updated_by_staff, updated_by_name, updated_at
  ) VALUES (
    v_tenant, v_order_id, (p_order->>'status')::order_status,
    'إنشاء الطلب عبر نقطة البيع', v_staff, COALESCE(v_staff_name, 'System'), v_now
  );

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
      v_invoice_number_str || '|' || v_total_amount::text || '|' ||
      v_tax_amount::text || '|' || v_now::text,
      'sha256'
    ),
    'base64'
  );

  UPDATE public.zatca_invoice_chain_state
     SET last_invoice_hash = v_invoice_hash, last_invoice_id = v_order_id, updated_at = v_now
   WHERE tenant_id = v_tenant;

  INSERT INTO public.tax_invoices (
    tenant_id, order_id, invoice_number, customer_id, customer_name,
    subtotal, tax_rate, tax_amount, discount_amount, paid_amount, total_amount,
    vat_number, qr_payload, issued_at, created_at, status, notes,
    invoice_hash, previous_invoice_hash
  ) VALUES (
    v_tenant, v_order_id, v_invoice_number_str,
    NULLIF(p_order->>'customer_id', '')::uuid, p_order->>'customer_name',
    v_discounted_subtotal, v_tax_fraction,
    v_tax_amount, v_discount_amount,
    v_paid_amount, v_total_amount,
    v_buyer_trn, v_qr_code,
    v_now, v_now,
    'issued', p_invoice->>'notes',
    v_invoice_hash, v_prev_hash
  )
  RETURNING id INTO v_invoice_id;

  IF v_paid_amount > 0 THEN
    INSERT INTO public.payments (tenant_id, order_id, invoice_id, shift_id, amount, method, received_by, notes)
    VALUES (v_tenant, v_order_id, v_invoice_id, v_shift, v_paid_amount,
            (p_order->>'payment_method')::payment_method, v_staff, 'بيع نقطة البيع');
  END IF;

  INSERT INTO public.employee_activity_logs (
    tenant_id, staff_id, staff_name, action, details, occurred_at
  ) VALUES (
    v_tenant, v_staff, COALESCE(v_staff_name, 'System'), 'create_invoice',
    'تم إنشاء فاتورة جديدة بقيمة ' || v_total_amount::text || ' للعميل ' || (p_order->>'customer_name'),
    v_now
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF NULLIF(v_item->>'item_id', '') IS NOT NULL THEN
      v_item_id := (v_item->>'item_id')::uuid;
      v_variant_id := NULLIF(v_item->>'variant_id', '')::uuid;
      BEGIN
        PERFORM public.apply_stock_movement(
          v_op_key || ':item:' || (v_item->>'item_id') || COALESCE(':variant:' || (v_item->>'variant_id'), ''),
          v_branch, v_item_id,
          -abs(COALESCE((v_item->>'quantity')::numeric, 0)), 'sale', v_order_id, 'pos_sale',
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

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'pos_sale',
          jsonb_build_object(
            'order_id', v_order_id, 'stock_conflicts', v_conflicts, 'tracking_token', v_tracking_token,
            'order_number', v_order_number, 'invoice_number', v_invoice_number_str,
            'subtotal', v_discounted_subtotal, 'discount_amount', v_discount_amount,
            'tax_amount', v_tax_amount, 'tax_rate', v_tax_fraction, 'total_amount', v_total_amount,
            'paid_amount', v_paid_amount, 'qr_code', v_qr_code
          ));

  RETURN jsonb_build_object(
    'order_id', v_order_id, 'stock_conflicts', v_conflicts, 'replayed', false, 'tracking_token', v_tracking_token,
    'order_number', v_order_number, 'invoice_number', v_invoice_number_str,
    'subtotal', v_discounted_subtotal, 'discount_amount', v_discount_amount,
    'tax_amount', v_tax_amount, 'tax_rate', v_tax_fraction, 'total_amount', v_total_amount,
    'paid_amount', v_paid_amount, 'qr_code', v_qr_code
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.create_pos_sale(UUID,JSONB,JSONB,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pos_sale(UUID,JSONB,JSONB,JSONB) TO authenticated;
