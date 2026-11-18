-- seen-status-fix-regressions-task.md item 5 (🟠, double-counted expected
-- cash). close_shift (20261115050000) sums cash/card/bank/credit TWICE
-- for the exact same money whenever an order that belongs to the shift
-- being closed (orders.shift_id = p_shift_id -- every POS sale) later
-- receives an ADDITIONAL payment via record_order_payment in the same
-- shift (e.g. POS.tsx's "settle debt" flow, fixed in
-- seen-cto-sprint4-permissions-task.md item 2 to call record_order_payment
-- instead of writing orders.paid_amount directly -- which is exactly what
-- turned this from a latent bug into a live one): the settlement amount
-- is counted once via the order's own (now higher) orders.paid_amount
-- (close_shift's orders-table sum), and a second time via the `payments`
-- row record_order_payment just inserted for the same shift_id
-- (close_shift's payments-table sum, added on top by 20261115050000 for
-- custom/tailoring orders, which have no shift_id and were a genuinely
-- disjoint set at the time).
--
-- The 20261115050000 migration's own "no double-counting risk" reasoning
-- ("create_pos_sale never writes to payments") was true until now and is
-- fixed here at the root: create_pos_sale now ALSO writes a `payments` row
-- for a sale's own initial payment (previously only visible via
-- orders.paid_amount), making `payments` the complete, single source of
-- truth for every cash movement against an order -- POS sale, custom-order
-- deposit (Orders.tsx, same commit), and any later settlement. close_shift
-- now sums cash/card/bank/credit from `payments` ALONE; totalSales/taxes/
-- discounts/orderCount/productBreakdown stay orders-table-sourced, as
-- before (a sale's line-item/VAT totals are not a "payment").
--
-- record_order_payment no longer overwrites orders.payment_method on a
-- partial settlement -- an order's payment_method is set once, at
-- creation (the method of its first/primary payment); a later partial
-- payment by a different method must not silently relabel the whole
-- order (this field is read elsewhere -- e.g. Reports.tsx -- as "how this
-- sale was paid").

-- -----------------------------------------------------------------------
-- 1) create_pos_sale: write the sale's own initial payment as a real
--    `payments` row (same table record_order_payment already writes to).
-- -----------------------------------------------------------------------
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

  -- Resolve each item's real price from the catalog (ready_made) instead
  -- of trusting the client, and build a resolved items array carrying the
  -- authoritative price so the insert loop below and the totals
  -- computation agree on the exact same number.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (v_item->>'type') = 'ready_made' AND NULLIF(v_item->>'item_id', '') IS NOT NULL THEN
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
      -- custom/bespoke line: no catalog price exists, the tailor's own
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

  -- seen-status-fix-regressions-task.md item 5: the sale's own initial
  -- payment, as a real `payments` row -- previously only visible via
  -- orders.paid_amount, which is what let close_shift's later
  -- payments-table addition (20261115050000) double-count a same-shift
  -- settlement. See this migration's header for the full reasoning.
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
    IF (v_item->>'type') = 'ready_made' AND NULLIF(v_item->>'item_id', '') IS NOT NULL THEN
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

-- -----------------------------------------------------------------------
-- 2) record_order_payment: stop overwriting orders.payment_method on a
--    partial settlement (an order's payment_method reflects how it was
--    originally paid, not whatever method its most recent top-up used).
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_order_payment(
  p_operation_id         UUID,
  p_order_id             UUID,
  p_amount               NUMERIC,
  p_method               payment_method,
  p_shift_id             UUID DEFAULT NULL,
  p_notes                TEXT DEFAULT NULL,
  p_complete_status      TEXT DEFAULT NULL,
  p_complete_status_key  TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant          uuid;
  v_staff           uuid;
  v_staff_name      text;
  v_op_key          text;
  v_existing        jsonb;

  v_total           numeric;
  v_paid            numeric;
  v_status          order_status;
  v_remaining       numeric;
  v_new_paid        numeric;
  v_new_remaining   numeric;
  v_invoice_id      uuid;
  v_completed       boolean := false;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار الدفعة' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'قيمة الدفعة يجب أن تكون أكبر من صفر' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'record_order_payment:' || p_operation_id::text;
  SELECT result INTO v_existing FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;

  IF p_shift_id IS NOT NULL THEN
    PERFORM 1 FROM public.shifts
     WHERE id = p_shift_id AND tenant_id = v_tenant AND status = 'open';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الوردية المحددة غير مفتوحة أو غير صحيحة' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT total_amount, paid_amount, status INTO v_total, v_paid, v_status
    FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_remaining := round(v_total - v_paid, 2);
  IF p_amount > v_remaining THEN
    RAISE EXCEPTION 'المبلغ أكبر من المتبقي على الطلب (المتبقي %)', v_remaining USING ERRCODE = '23514';
  END IF;

  v_new_paid := round(v_paid + p_amount, 2);
  v_new_remaining := round(v_total - v_new_paid, 2);
  v_completed := v_new_remaining = 0 AND p_complete_status IS NOT NULL;

  -- payment_method is no longer touched here -- it reflects the order's
  -- original/primary payment, set once at creation (Orders.tsx form /
  -- create_pos_sale); a later partial settlement must not silently
  -- relabel the whole order by whatever method happened to pay it off.
  IF v_completed THEN
    UPDATE public.orders SET
      paid_amount = v_new_paid,
      status = p_complete_status::order_status,
      status_key = p_complete_status_key,
      updated_at = now()
    WHERE id = p_order_id;
  ELSE
    UPDATE public.orders SET
      paid_amount = v_new_paid,
      updated_at = now()
    WHERE id = p_order_id;
  END IF;

  SELECT id INTO v_invoice_id FROM public.tax_invoices WHERE order_id = p_order_id ORDER BY issued_at DESC LIMIT 1;

  INSERT INTO public.payments (tenant_id, order_id, invoice_id, shift_id, amount, method, received_by, notes)
  VALUES (v_tenant, p_order_id, v_invoice_id, p_shift_id, p_amount, p_method, v_staff, p_notes);

  INSERT INTO public.order_history (tenant_id, order_id, status, notes, updated_by_staff, updated_by_name)
  VALUES (
    v_tenant, p_order_id,
    CASE WHEN v_completed THEN p_complete_status::order_status ELSE v_status END,
    p_notes, v_staff, COALESCE(v_staff_name, 'Staff')
  );

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'record_order_payment', jsonb_build_object(
    'order_id', p_order_id, 'paid_amount', v_new_paid, 'remaining_amount', v_new_remaining, 'completed', v_completed
  ));

  RETURN jsonb_build_object(
    'order_id', p_order_id, 'paid_amount', v_new_paid, 'remaining_amount', v_new_remaining,
    'completed', v_completed, 'replayed', false
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.record_order_payment(UUID, UUID, NUMERIC, payment_method, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_order_payment(UUID, UUID, NUMERIC, payment_method, UUID, TEXT, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------
-- 3) close_shift: source cash/card/bank_transfer/credit from `payments`
--    alone (now the complete, single source of truth for every payment
--    against any order -- POS sale, custom-order deposit, or later
--    settlement, all shift-attributed). totalSales/taxes/discounts/
--    orderCount/productBreakdown stay orders-table-sourced, unchanged --
--    those are sale totals, not payments, and were never double-counted.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_shift(
  p_operation_id    UUID,
  p_shift_id        UUID,
  p_actual_cash     NUMERIC,
  p_reason          TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant          uuid;
  v_staff           uuid;
  v_staff_name      text;
  v_role            text;
  v_op_key          text;
  v_existing        jsonb;

  v_shift_staff     uuid;
  v_shift_status    shift_status;
  v_opening         numeric;

  v_cash            numeric;
  v_card            numeric;
  v_bank_transfer   numeric;
  v_credit          numeric;
  v_total_sales     numeric;
  v_tax_amount      numeric;
  v_discount_amount numeric;
  v_gross_sales     numeric;
  v_order_count     integer;
  v_items_sold      numeric;
  v_product_breakdown jsonb;

  v_total_returns   numeric;
  v_return_count    integer;
  v_returns_cash    numeric;
  v_deposits        numeric;
  v_payouts         numeric;

  v_expected_cash   numeric;
  v_discrepancy     numeric;
  v_totals          jsonb;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار إغلاق الوردية' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'close_shift:' || p_operation_id::text;
  SELECT result INTO v_existing FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;
  v_role := public.app_current_role();

  SELECT staff_id, status, opening_balance INTO v_shift_staff, v_shift_status, v_opening
    FROM public.shifts
   WHERE id = p_shift_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_shift_status <> 'open' THEN
    RAISE EXCEPTION 'الوردية مغلقة بالفعل' USING ERRCODE = '22023';
  END IF;

  IF v_staff IS DISTINCT FROM v_shift_staff AND (v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager')) THEN
    RAISE EXCEPTION 'لا تملك صلاحية إغلاق وردية موظف آخر' USING ERRCODE = '42501';
  END IF;

  -- Sale totals: orders table only (unchanged) -- a sale's line-item/VAT
  -- figures, not a payment amount.
  SELECT
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(tax_amount), 0),
    COALESCE(SUM(discount_amount), 0),
    COUNT(*)
  INTO v_total_sales, v_tax_amount, v_discount_amount, v_order_count
  FROM public.orders
  WHERE shift_id = p_shift_id AND tenant_id = v_tenant AND status <> 'cancelled';

  -- Cash collected: `payments` alone, now the single source of truth for
  -- every payment against any order attributed to this shift (POS sale's
  -- own initial payment, a custom-order deposit, or a later settlement --
  -- see this migration's header).
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE method = 'cash'), 0),
    COALESCE(SUM(amount) FILTER (WHERE method = 'network'), 0),
    COALESCE(SUM(amount) FILTER (WHERE method = 'bank_transfer'), 0),
    COALESCE(SUM(amount) FILTER (WHERE method IN ('cash_on_delivery', 'partial')), 0)
  INTO v_cash, v_card, v_bank_transfer, v_credit
  FROM public.payments
  WHERE shift_id = p_shift_id AND tenant_id = v_tenant;

  v_gross_sales := v_total_sales + v_discount_amount;

  SELECT COALESCE(SUM(oi.quantity), 0) INTO v_items_sold
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
   WHERE o.shift_id = p_shift_id AND o.tenant_id = v_tenant AND o.status <> 'cancelled';

  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', b.name, 'quantity', b.quantity, 'total', b.total) ORDER BY b.quantity DESC), '[]'::jsonb)
    INTO v_product_breakdown
  FROM (
    SELECT
      CASE WHEN oi.type = 'custom' THEN COALESCE(oi.garment_type, 'صنف مخصص')
           ELSE COALESCE(oi.name, 'صنف جاهز') END AS name,
      SUM(oi.quantity) AS quantity,
      SUM(oi.price * oi.quantity) AS total
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.shift_id = p_shift_id AND o.tenant_id = v_tenant AND o.status <> 'cancelled'
    GROUP BY 1
  ) b;

  SELECT
    COALESCE(SUM(refunded_amount), 0),
    COUNT(*),
    COALESCE(SUM(refunded_amount) FILTER (WHERE refund_method = 'cash'), 0)
  INTO v_total_returns, v_return_count, v_returns_cash
  FROM public.sales_returns
  WHERE shift_id = p_shift_id AND tenant_id = v_tenant;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'deposit'), 0),
    COALESCE(SUM(amount) FILTER (WHERE entry_type = 'payout'), 0)
  INTO v_deposits, v_payouts
  FROM public.shift_entries
  WHERE shift_id = p_shift_id AND tenant_id = v_tenant;

  v_expected_cash := ROUND(COALESCE(v_opening, 0) + v_cash + v_deposits - v_returns_cash - v_payouts, 2);
  v_discrepancy := ROUND(COALESCE(p_actual_cash, 0) - v_expected_cash, 2);

  v_totals := jsonb_build_object(
    'cash', v_cash,
    'card', v_card,
    'bank_transfer', v_bank_transfer,
    'credit', v_credit,
    'cashReturns', v_returns_cash,
    'totalReturns', v_total_returns,
    'returnCount', v_return_count,
    'expenses', v_payouts,
    'totalDeposits', v_deposits,
    'taxes', v_tax_amount,
    'totalSales', v_total_sales,
    'grossSales', v_gross_sales,
    'discounts', v_discount_amount,
    'orderCount', v_order_count,
    'itemsSoldCount', v_items_sold,
    'productBreakdown', v_product_breakdown
  );

  UPDATE public.shifts SET
    status = 'closed',
    end_time = now(),
    closing_balance = p_actual_cash,
    actual_cash = p_actual_cash,
    expected_cash = v_expected_cash,
    discrepancy = v_discrepancy,
    discrepancy_reason = NULLIF(p_reason, ''),
    totals = v_totals,
    closed_by = v_staff,
    updated_at = now()
  WHERE id = p_shift_id;

  BEGIN
    INSERT INTO public.employee_activity_logs (tenant_id, staff_id, staff_name, action, details, occurred_at)
    VALUES (v_tenant, v_staff, COALESCE(v_staff_name, 'Staff'), 'close_shift',
            'إغلاق وردية -- المتوقع ' || v_expected_cash::text || ' الفعلي ' || COALESCE(p_actual_cash, 0)::text
              || ' الفرق ' || v_discrepancy::text, now());
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'close_shift', jsonb_build_object(
    'shift_id', p_shift_id, 'expected_cash', v_expected_cash, 'actual_cash', p_actual_cash,
    'discrepancy', v_discrepancy, 'totals', v_totals
  ));

  RETURN jsonb_build_object(
    'shift_id', p_shift_id, 'expected_cash', v_expected_cash, 'actual_cash', p_actual_cash,
    'discrepancy', v_discrepancy, 'totals', v_totals, 'replayed', false
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.close_shift(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.close_shift(UUID, UUID, NUMERIC, TEXT) TO authenticated;
