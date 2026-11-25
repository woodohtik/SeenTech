-- Rollback of 20270115000000_pos_sale_fabric_at_cutting.sql: the three
-- functions as they were before it. order_items.fabric_taken_meters and the
-- kind = 'pos_sale' marks stay (nothing older reads them); a POS thobe is
-- then refused at cutting again, as before.
CREATE OR REPLACE FUNCTION public.create_pos_sale(p_operation_id uuid, p_order jsonb, p_items jsonb, p_invoice jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant              uuid;
  v_staff               uuid;
  v_staff_name          text;
  v_branch              uuid;
  v_shift               uuid;
  v_order_id            uuid := p_operation_id;
  v_tracking_token      uuid;
  v_op_key              text;
  v_line_no             int := 0;
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
  v_shift_start         timestamptz;
  v_sold_at             timestamptz;
  v_block               record;
  v_slot                int;
  v_items_resolved      jsonb := '[]'::jsonb;
  v_line_tax_type       text;
  v_doc                 jsonb;
  v_ord                 bigint;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار البيع' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'pos_sale:' || p_operation_id::text;
  -- P6 (MONEY-17): one operation at a time -- a concurrent repeat waits here,
  -- then finds the sale recorded and returns it as replayed.
  PERFORM pg_advisory_xact_lock(hashtext(v_op_key));

  SELECT result INTO v_existing
    FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_staff := public.app_actor_staff_id();

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

  SELECT id, branch_id, start_time INTO v_shift, v_branch, v_shift_start
    FROM public.shifts
   WHERE id = v_shift AND tenant_id = v_tenant AND staff_id = v_staff AND status = 'open'
   FOR SHARE;
  IF v_shift IS NULL THEN
    RAISE EXCEPTION 'الوردية المحدَّدة غير مفتوحة أو لا تخصّك' USING ERRCODE = '22023';
  END IF;

  -- seen-readiness-fixes-task.md P3.2 (RELIABILITY-02): a sale made offline
  -- keeps the moment it was made -- the time its receipt printed -- as long
  -- as that falls inside its shift and is not in the future. Anything else
  -- (or unreadable) is now, as before.
  BEGIN
    v_sold_at := NULLIF(p_order->>'sold_at', '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_sold_at := NULL;
  END;
  IF v_sold_at IS NOT NULL AND v_sold_at <= now() + interval '2 minutes'
     AND v_sold_at >= v_shift_start - interval '1 minute' THEN
    v_now := LEAST(v_sold_at, now());
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

      SELECT price_per_unit, tax_type INTO v_catalog_price, v_line_tax_type
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
      -- A bespoke line's tax type is the one the cashier saw (no catalog row to read it from).
      v_line_tax_type := v_item->>'taxType';
    END IF;

    v_subtotal_exvat := v_subtotal_exvat
      + ROUND(v_effective_price * COALESCE((v_item->>'quantity')::numeric, 0), 2);

    v_items_resolved := v_items_resolved || jsonb_build_object(
      'item', v_item, 'price', v_effective_price,
      'quantity', COALESCE((v_item->>'quantity')::numeric, 0),
      'taxType', CASE WHEN v_line_tax_type IN ('inclusive', 'exempt') THEN v_line_tax_type ELSE 'exclusive' END);
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

  -- seen-readiness-fixes-task.md P1.1: the one tax engine (app_tax_document,
  -- the same rules as src/shared/taxEngine.ts): each line by its own tax type
  -- (the catalog item's tax_type), the discount off what the customer pays,
  -- shared over the lines, and the document = the sum of its lines.
  v_doc := public.app_tax_document(
    (SELECT coalesce(jsonb_agg(jsonb_build_object('price', x->'price', 'quantity', x->'quantity', 'taxType', x->'taxType') ORDER BY o), '[]'::jsonb)
       FROM jsonb_array_elements(v_items_resolved) WITH ORDINALITY AS t(x, o)),
    v_tax_fraction, v_discount_type, v_discount_value, v_max_discount_pct);
  v_gross_before        := (v_doc->>'grossBefore')::numeric;
  v_subtotal_exvat      := (v_doc->>'netBefore')::numeric;
  v_discount_gross      := (v_doc->>'discountGross')::numeric;
  v_total_amount        := (v_doc->>'total')::numeric;
  v_discounted_subtotal := (v_doc->>'subtotal')::numeric;
  v_tax_amount          := (v_doc->>'tax')::numeric;
  v_discount_amount     := (v_doc->>'discountNet')::numeric;

  v_paid_amount := COALESCE((p_order->>'paid_amount')::numeric, 0);
  IF v_paid_amount > v_total_amount THEN
    RAISE EXCEPTION 'المبلغ المدفوع (%) أكبر من إجمالي الفاتورة (%)', v_paid_amount, v_total_amount
      USING ERRCODE = '22023';
  END IF;

  -- P3.2: the numbers printed offline. Slot n of a block this shop reserved
  -- in advance (reserve_offline_numbers) -- taken from the shop's own
  -- counters, so they can never clash with numbers given out online; the
  -- unique indexes on (tenant_id, order_number / invoice_number) refuse a
  -- slot used twice.
  IF p_order ? 'offline_number' THEN
    BEGIN
      v_slot := (p_order->'offline_number'->>'slot')::int;
      SELECT * INTO v_block FROM public.offline_number_blocks
       WHERE id = (p_order->'offline_number'->>'block_id')::uuid AND tenant_id = v_tenant;
    EXCEPTION WHEN others THEN
      v_block := NULL;
    END;
    IF v_block.id IS NULL OR v_slot IS NULL OR v_slot < 0 OR v_slot >= v_block.size THEN
      RAISE EXCEPTION 'رقم الفاتورة المحجوز لهذا الجهاز غير صالح' USING ERRCODE = '22023';
    END IF;
    v_order_number := v_block.order_from + v_slot;
    v_invoice_number := v_block.invoice_from + v_slot;
  ELSE
    SELECT order_number, invoice_number INTO v_order_number, v_invoice_number
      FROM public.allocate_tenant_sale_numbers(v_tenant);
  END IF;
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

  FOR v_item, v_effective_price, v_ord IN
    SELECT e->'item', (e->>'price')::numeric, o FROM jsonb_array_elements(v_items_resolved) WITH ORDINALITY AS t(e, o)
  LOOP
    INSERT INTO public.order_items (
      tenant_id, order_id, type, status, item_id, variant_id, name, garment_type, fabric,
      fabric_id, quantity, selected_unit, consumed_meters, price,
      closure_type, closure_visibility, collar_type, cuff_type, pocket_type,
      chest_style, shoulder_style, cutting_type, collar_padding, additions, embroidery, measurements,
      tax_type, line_net, line_tax, line_discount
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
      COALESCE(v_item->'measurements', '{}'::jsonb),
      v_doc->'lines'->((v_ord - 1)::int)->>'taxType',
      (v_doc->'lines'->((v_ord - 1)::int)->>'netAfter')::numeric,
      (v_doc->'lines'->((v_ord - 1)::int)->>'taxAfter')::numeric,
      (v_doc->'lines'->((v_ord - 1)::int)->>'discount')::numeric
    );
  END LOOP;

  INSERT INTO public.order_history (
    tenant_id, order_id, status, notes, updated_by_staff, updated_by_name, updated_at
  ) VALUES (
    v_tenant, v_order_id, (p_order->>'status')::order_status,
    'إنشاء الطلب عبر نقطة البيع' || public.app_offline_note(), v_staff, COALESCE(v_staff_name, 'System'), v_now
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
            -- P1.3 (MONEY-03): "partial" describes the order; the money paid now
            -- is cash (or what the cashier chose), so the shift counts it.
            CASE WHEN p_order->>'payment_method' = 'partial'
                 THEN COALESCE(NULLIF(p_order->>'paid_method', ''), 'cash')
                 ELSE p_order->>'payment_method' END::payment_method,
            v_staff, 'بيع نقطة البيع');
  END IF;

  INSERT INTO public.employee_activity_logs (
    tenant_id, staff_id, staff_name, action, details, occurred_at
  ) VALUES (
    v_tenant, v_staff, COALESCE(v_staff_name, 'System'), 'create_invoice',
    'تم إنشاء فاتورة جديدة بقيمة ' || v_total_amount::text || ' للعميل ' || (p_order->>'customer_name'),
    v_now
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    -- S-19: the line number is part of the key, so two lines of the same item both move stock.
    v_line_no := v_line_no + 1;
    IF NULLIF(v_item->>'item_id', '') IS NOT NULL THEN
      v_item_id := (v_item->>'item_id')::uuid;
      v_variant_id := NULLIF(v_item->>'variant_id', '')::uuid;
      BEGIN
        PERFORM public.apply_stock_movement(
          v_op_key || ':item:' || (v_item->>'item_id') || COALESCE(':variant:' || (v_item->>'variant_id'), '') || ':line:' || v_line_no,
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
          v_op_key || ':fabric:' || (v_item->>'fabric_id') || ':line:' || v_line_no,
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
END $function$;

CREATE OR REPLACE FUNCTION public.update_order_status(p_order_id uuid, p_status text, p_status_key text, p_notes text DEFAULT NULL::text, p_op_id uuid DEFAULT NULL::uuid, p_history_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant      uuid;
  v_role        text;
  v_staff       uuid;
  v_staff_name  text;
  v_op_key      text;
  v_existing    jsonb;
  v_total       numeric;
  v_paid        numeric;
  v_status      order_status;
  v_kind        text;
  v_deducted    timestamptz;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_current_role();
  IF NOT public.app_has_permission('orders.update_status') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل حالة الطلب' USING ERRCODE = '42501';
  END IF;

  IF p_op_id IS NOT NULL THEN
    v_op_key := 'update_order_status:' || p_op_id::text;
    SELECT result INTO v_existing FROM public.stock_operations
     WHERE operation_id = v_op_key AND tenant_id = v_tenant;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing || jsonb_build_object('replayed', true);
    END IF;
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;

  SELECT total_amount, paid_amount, status, kind, fabric_deducted_at
    INTO v_total, v_paid, v_status, v_kind, v_deducted
    FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن تعديل طلب تم تسليمه أو إلغاؤه' USING ERRCODE = '42501';
  END IF;

  -- seen-readiness-fixes-task.md P1.4 (MONEY-05): a paid order is cancelled
  -- only through cancel_order(), which gives the money back from a shift.
  IF p_status = 'cancelled' AND v_paid > 0 THEN
    RAISE EXCEPTION 'على هذا الطلب مبلغ مدفوع: ألغِه من «إلغاء مع رد المبلغ»' USING ERRCODE = '22023', HINT = 'cancel_with_refund';
  END IF;

  IF p_status = 'delivered' AND round(v_total - v_paid, 2) > 0 THEN
    RAISE EXCEPTION 'لا يمكن تسليم طلب عليه مبلغ متبقٍ' USING ERRCODE = '23514';
  END IF;

  UPDATE public.orders SET
    status      = p_status::order_status,
    status_key  = p_status_key,
    notes       = CASE WHEN v_kind = 'tailoring' THEN notes ELSE COALESCE(p_notes, notes) END,
    updated_at  = now()
  WHERE id = p_order_id;

  -- order_status sorts measurements_taken < cutting < ... < delivered <
  -- cancelled, so "cutting or later, not cancelled" is a range check.
  IF v_kind = 'tailoring' AND v_deducted IS NULL
     AND p_status::order_status >= 'cutting'::order_status
     AND p_status::order_status <> 'cancelled'::order_status THEN
    PERFORM public.deduct_order_fabric(p_order_id, NULL);
  END IF;

  INSERT INTO public.order_history (tenant_id, order_id, status, notes, updated_by_staff, updated_by_name)
  VALUES (v_tenant, p_order_id, p_status::order_status, p_history_note, v_staff, COALESCE(v_staff_name, 'Staff'));

  IF p_op_id IS NOT NULL THEN
    INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
    VALUES (v_op_key, v_tenant, 'update_order_status', jsonb_build_object(
      'order_id', p_order_id, 'status', p_status, 'status_key', p_status_key
    ));
  END IF;

  RETURN jsonb_build_object('order_id', p_order_id, 'status', p_status, 'status_key', p_status_key, 'replayed', false);
END $function$;

CREATE OR REPLACE FUNCTION public.update_order_status_with_fabric(p_order_id uuid, p_status text, p_status_key text, p_fabric_lines jsonb, p_notes text DEFAULT NULL::text, p_op_id uuid DEFAULT NULL::uuid, p_history_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_max_per_piece CONSTANT numeric := 15;
  c_max_legacy    CONSTANT numeric := 100;
  v_tenant    uuid;
  v_role      text;
  v_kind      text;
  v_deducted  timestamptz;
  v_notes     text;
  v_meta      jsonb;
  v_line      jsonb;
  v_meters    numeric;
  v_stored    numeric;
  v_qty       numeric;
  v_fabric    uuid;
  v_changes   text := '';
  v_note      text := p_history_note;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_current_role();
  IF NOT public.app_has_permission('orders.update_status') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل حالة الطلب' USING ERRCODE = '42501';
  END IF;

  SELECT kind, fabric_deducted_at, notes INTO v_kind, v_deducted, v_notes
    FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_deducted IS NULL AND jsonb_typeof(p_fabric_lines) = 'array'
     AND p_status::order_status >= 'cutting'::order_status
     AND p_status::order_status <> 'cancelled'::order_status THEN

    IF v_kind = 'tailoring' THEN
      FOR v_line IN SELECT * FROM jsonb_array_elements(p_fabric_lines) LOOP
        v_meters := NULLIF(v_line->>'meters', '')::numeric;
        IF v_meters IS NULL OR v_meters < 0 THEN
          RAISE EXCEPTION 'كمية القماش غير صالحة' USING ERRCODE = '22023';
        END IF;

        -- The line must be one of this order's own stock-cloth lines.
        SELECT COALESCE(consumed_meters, 0), quantity INTO v_stored, v_qty
          FROM public.order_items
         WHERE id = NULLIF(v_line->>'line_key', '')::uuid
           AND order_id = p_order_id AND tenant_id = v_tenant
           AND type = 'custom' AND fabric_id IS NOT NULL;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'سطر القماش لا يتبع هذا الطلب' USING ERRCODE = '42501';
        END IF;

        IF v_meters > c_max_per_piece * GREATEST(v_qty, 1) THEN
          RAISE EXCEPTION 'كمية القماش (% م) أكبر من الحد المسموح لهذا السطر (% م)',
            v_meters, c_max_per_piece * GREATEST(v_qty, 1) USING ERRCODE = '22023';
        END IF;

        IF v_meters IS DISTINCT FROM v_stored THEN
          v_changes := v_changes || CASE WHEN v_changes = '' THEN '' ELSE '، ' END
                       || v_stored::text || ' ← ' || v_meters::text || ' م';
          UPDATE public.order_items
             SET consumed_meters = v_meters
           WHERE id = (v_line->>'line_key')::uuid;
        END IF;
      END LOOP;

    ELSE
      -- An older order keeps its lines inside `notes`. Read them from the
      -- STORED notes (not from p_notes, which the caller supplies) and accept
      -- a deduction only for a cloth one of those lines names.
      v_meta := NULL;
      IF v_notes LIKE '\_\_ORDER\_%:{%' THEN
        BEGIN
          v_meta := substring(v_notes FROM position(':' IN v_notes) + 1)::jsonb;
        EXCEPTION WHEN OTHERS THEN
          v_meta := NULL;
        END;
      END IF;
      IF v_meta IS NULL OR jsonb_typeof(v_meta->'items') <> 'array' THEN
        RAISE EXCEPTION 'تعذّر التحقق من أصناف الطلب لخصم القماش' USING ERRCODE = '22023';
      END IF;

      FOR v_line IN SELECT * FROM jsonb_array_elements(p_fabric_lines) LOOP
        v_meters := NULLIF(v_line->>'meters', '')::numeric;
        v_fabric := NULLIF(v_line->>'fabric_id', '')::uuid;
        IF v_meters IS NULL OR v_meters < 0 OR v_meters > c_max_legacy THEN
          RAISE EXCEPTION 'كمية القماش غير صالحة' USING ERRCODE = '22023';
        END IF;
        IF v_fabric IS NULL OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_meta->'items') it
           WHERE it->>'fabricId' = v_fabric::text
        ) THEN
          RAISE EXCEPTION 'القماش لا يتبع هذا الطلب' USING ERRCODE = '42501';
        END IF;
      END LOOP;
      -- S-08: however many lines are sent, a cloth gets no more than 15 m a
      -- piece of the order's items that name it.
      IF EXISTS (
        SELECT 1 FROM (
          SELECT l->>'fabric_id' AS f, sum(NULLIF(l->>'meters', '')::numeric) AS m
            FROM jsonb_array_elements(p_fabric_lines) l GROUP BY 1
        ) req
        WHERE req.m > c_max_per_piece * GREATEST(coalesce((
          SELECT sum(GREATEST(coalesce(NULLIF(it->>'quantity', '')::numeric, 1), 1))
            FROM jsonb_array_elements(v_meta->'items') it WHERE it->>'fabricId' = req.f), 1), 1)
      ) THEN
        RAISE EXCEPTION 'كمية القماش أكبر من المسموح لأصناف الطلب' USING ERRCODE = '22023';
      END IF;
      PERFORM public.deduct_order_fabric(p_order_id, p_fabric_lines);
    END IF;
  END IF;

  IF v_changes <> '' THEN
    v_note := COALESCE(NULLIF(p_history_note, '') || ' | ', '') || 'تعديل كمية القماش عند القص: ' || v_changes;
  END IF;

  RETURN public.update_order_status(p_order_id, p_status, p_status_key, p_notes, p_op_id, v_note);
END $function$;

CREATE OR REPLACE FUNCTION public.guard_financial_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'orders' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.kind IS NOT NULL OR NEW.fabric_deducted_at IS NOT NULL THEN
        RAISE EXCEPTION 'هذا الطلب يُنشأ عبر النظام فقط' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
       OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
       OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate
       OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.fabric_deducted_at IS DISTINCT FROM OLD.fabric_deducted_at
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'مبالغ الطلب لا تُعدَّل مباشرة' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'order_items' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'أصناف الطلب تُضاف عبر النظام فقط' USING ERRCODE = '42501';
    ELSIF NEW.price IS DISTINCT FROM OLD.price
       OR NEW.quantity IS DISTINCT FROM OLD.quantity
       OR NEW.consumed_meters IS DISTINCT FROM OLD.consumed_meters
       OR NEW.fabric_id IS DISTINCT FROM OLD.fabric_id
       OR NEW.item_id IS DISTINCT FROM OLD.item_id
       OR NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'أصناف الطلب لا تُعدَّل مباشرة' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'payments' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'الدفعات تُسجَّل عبر النظام فقط' USING ERRCODE = '42501';
    ELSIF NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.method IS DISTINCT FROM OLD.method
       OR NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
       OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'الدفعات لا تُعدَّل مباشرة' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $function$;
