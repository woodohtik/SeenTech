-- Security audit of 22 Nov 2026 (docs/security/audit-2026-11-22), batch 3:
-- money, stock and records.
--
-- S-08  An older order's fabric deduction took any number of lines (100 m
--       each) for a cloth the order names: now at most 15 m a piece of the
--       items that name it, however many lines are sent.
-- S-19  A sale with the same item on two lines moved stock for the first
--       line only (the two shared a movement key). The line number is now
--       part of the key.
-- S-23  A shop referred by both a shop and a partner paid both rewards. The
--       referral recorded first takes it; the other is marked expired.
-- S-27  A new order accepted any fabric length, deducted at cutting. Now at
--       most 15 m a piece, as the review window already allowed.
-- S-28  Any holder of invoices.view (a cashier) could issue a tax invoice by
--       hand. Now invoices.view and reports.tax (owner, admin, manager,
--       accountant). The automatic issue on delivery or payment is unchanged.
-- S-41  A permanently deleted shop left rows in ten tables, readable by a
--       shop later created with the same id. They go with it now.
-- S-43  A return could name the same sold line twice and return more than
--       was sold. Each line once.
-- Found closed already: S-24, S-26 (credit notes are stamped into the chain
-- when issued; the old claim function is not callable), S-42 (issued credit
-- notes are immutable), S-44 (a payment needs the caller's own open shift).

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

CREATE OR REPLACE FUNCTION public.process_sales_return(p_operation_id uuid, p_order_id uuid, p_shift_id uuid, p_items jsonb, p_reason text DEFAULT NULL::text, p_refund_method payment_method DEFAULT 'cash'::payment_method)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_note_value          numeric;
  v_credited            numeric := 0;
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
  IF NOT public.app_has_permission('action.refund') THEN
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

  -- S-43: each sold line once per return; repeating it would return more than was sold.
  IF (SELECT count(*) FROM jsonb_array_elements(p_items))
     <> (SELECT count(DISTINCT e->>'order_item_id') FROM jsonb_array_elements(p_items) e) THEN
    RAISE EXCEPTION 'الصنف مكرر في المرتجع' USING ERRCODE = '22023';
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
  -- P6 (MONEY-13): the credit note is the full returned value; only the
  -- cash given back is capped by what was paid and not yet refunded. The
  -- rest is taken off what the customer still owes (orders.credited_amount).
  v_note_value := v_refund_gross;
  v_refund_gross := LEAST(v_refund_gross, v_refundable_ceiling);
  v_credited := v_note_value - v_refund_gross;

  SELECT 'RET-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(v_return_id::text, 1, 8) INTO v_return_number;

  INSERT INTO public.sales_returns (
    id, tenant_id, invoice_id, order_id, shift_id, return_number, status, reason,
    total_amount, refunded_amount, refund_method, processed_by, returned_at, created_at
  ) VALUES (
    v_return_id, v_tenant, v_invoice_id, p_order_id, p_shift_id, v_return_number, 'completed',
    NULLIF(p_reason, ''), v_note_value, v_refund_gross, p_refund_method, v_staff, now(), now()
  );

  IF v_credited > 0 THEN
    UPDATE public.orders SET credited_amount = credited_amount + v_credited WHERE id = p_order_id;
  END IF;

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
                              'refunded_amount', v_refund_gross, 'tax_amount', v_refund_tax,
                              'credit_note_amount', v_note_value, 'credited_amount', v_credited));

  RETURN jsonb_build_object('return_id', v_return_id, 'return_number', v_return_number,
                             'refunded_amount', v_refund_gross, 'tax_amount', v_refund_tax,
                             'credit_note_amount', v_note_value, 'credited_amount', v_credited, 'replayed', false);
END $function$;

CREATE OR REPLACE FUNCTION public.create_tailoring_order(p_operation_id uuid, p_order jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant          uuid;
  v_staff           uuid;
  v_staff_name      text;
  v_branch          uuid;
  v_op_key          text;
  v_existing        jsonb;

  v_customer_id     uuid;
  v_customer_name   text;
  v_measurements    jsonb;
  v_tailor          uuid;

  v_status          order_status;
  v_status_key      text;
  v_method          payment_method;

  v_item            jsonb;
  v_qty             numeric;
  v_price           numeric;
  v_fabric_id       uuid;
  v_consumed        numeric;
  v_items_total     numeric := 0;
  v_discount        numeric;
  v_taxable         numeric;

  v_tax_enabled     boolean;
  v_tax_type        text;
  v_rate_pct        numeric;
  v_rate            numeric;
  v_tax_amount      numeric := 0;
  v_total           numeric;
  v_tax_rate_stored numeric := 0;
  v_doc             jsonb;
  v_idx             int := 0;

  v_paid            numeric;
  v_shift           uuid;
  v_deposit_skipped boolean := false;
  v_order_number    bigint;
  v_order           jsonb;
  v_result          jsonb;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار الطلب' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'create_tailoring_order:' || p_operation_id::text;
  -- Two copies of the same save (a double click, or an offline replay racing
  -- the original) wait here in turn, so the second one finds the first one's
  -- recorded result below instead of failing on the order's primary key.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_op_key, 0));
  SELECT result INTO v_existing FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  IF NOT public.app_has_permission('orders.create') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إنشاء الطلبات' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'الطلب بلا أصناف' USING ERRCODE = '22023';
  END IF;

  v_staff := public.app_actor_staff_id();
  SELECT name, branch_id INTO v_staff_name, v_branch
    FROM public.staff WHERE id = v_staff AND tenant_id = v_tenant;

  -- Customer: must be this shop's; the name and the measurement snapshot come
  -- from the row, not from the browser.
  v_customer_id := NULLIF(p_order->>'customer_id', '')::uuid;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'العميل مطلوب' USING ERRCODE = '22023';
  END IF;
  SELECT name, COALESCE(measurements, '{}'::jsonb) INTO v_customer_name, v_measurements
    FROM public.customers WHERE id = v_customer_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_tailor := NULLIF(p_order->>'assigned_tailor_id', '')::uuid;
  IF v_tailor IS NOT NULL THEN
    PERFORM 1 FROM public.staff WHERE id = v_tailor AND tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A new order always starts at the first stage. The stage is not taken
  -- from the browser: accepting it let a caller create an order already
  -- "delivered" with nothing paid, past the rule that an order with a balance
  -- cannot be delivered. Every later stage goes through update_order_status.
  v_status := 'measurements_taken'::order_status;
  -- status_key is the activity's own name for its first stage (free text for
  -- activities other than men's tailoring). It may not borrow the name of a
  -- later fixed stage.
  v_status_key := COALESCE(NULLIF(left(p_order->>'status_key', 80), ''), 'measurements_taken');
  IF v_status_key IN ('cutting', 'sewing', 'embroidery', 'ironing_packaging', 'ready',
                      'partial_delivered', 'delivered', 'cancelled') THEN
    RAISE EXCEPTION 'الطلب الجديد يبدأ من أول مرحلة' USING ERRCODE = '22023';
  END IF;
  v_method := COALESCE(NULLIF(p_order->>'payment_method', ''), 'cash')::payment_method;

  -- Lines: whole pieces at a piece price. Validated before anything is written.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := NULLIF(v_item->>'quantity', '')::numeric;
    v_price := COALESCE(NULLIF(v_item->>'price', '')::numeric, 0);
    IF v_qty IS NULL OR v_qty < 1 OR v_qty <> trunc(v_qty) THEN
      RAISE EXCEPTION 'الكمية يجب أن تكون عدد قطع صحيحاً' USING ERRCODE = '22023';
    END IF;
    -- The piece price is whatever the shop agrees with the customer: a
    -- tailored garment has no catalogue price to check it against. That is
    -- deliberate. What needs action.discount is the discount field below.
    IF v_price < 0 THEN
      RAISE EXCEPTION 'سعر القطعة غير صالح' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(NULLIF(v_item->>'garment_type', ''), '') = '' THEN
      RAISE EXCEPTION 'نوع القطعة مطلوب' USING ERRCODE = '22023';
    END IF;
    -- S-27: the same ceiling the review window applies: 15 m a piece.
    IF COALESCE(NULLIF(v_item->>'consumed_meters', '')::numeric, 0) < 0
       OR COALESCE(NULLIF(v_item->>'consumed_meters', '')::numeric, 0) > 15 * v_qty THEN
      RAISE EXCEPTION 'كمية القماش غير صالحة' USING ERRCODE = '22023';
    END IF;
    v_fabric_id := NULLIF(v_item->>'fabric_id', '')::uuid;
    IF v_fabric_id IS NOT NULL THEN
      PERFORM 1 FROM public.inventory_items WHERE id = v_fabric_id AND tenant_id = v_tenant;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
      END IF;
    END IF;
    v_items_total := v_items_total + v_price * v_qty;
  END LOOP;

  v_discount := GREATEST(COALESCE(NULLIF(p_order->>'discount_amount', '')::numeric, 0), 0);
  IF v_discount > 0 AND NOT public.app_has_permission('action.discount') THEN
    RAISE EXCEPTION 'لا تملك صلاحية منح خصم' USING ERRCODE = '42501';
  END IF;
  -- Tailoring tax: the shop's rules from public.tenant_tax_rules (one source
  -- with the browser's resolveTailoringTax), now through the one tax engine
  -- (seen-readiness-fixes-task.md P1.1): every line takes the shop's tailoring
  -- tax type, the discount comes off what the customer pays and is capped by
  -- the role's maximum discount (MONEY-09), and the order = the sum of its lines.
  SELECT r.enabled, r.tax_type, r.rate_pct INTO v_tax_enabled, v_tax_type, v_rate_pct
    FROM public.tenant_tax_rules(v_tenant) r;
  v_rate := CASE WHEN v_tax_enabled AND v_tax_type <> 'exempt' THEN v_rate_pct / 100 ELSE 0 END;
  v_doc := public.app_tax_document(
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'price', COALESCE(NULLIF(x->>'price', '')::numeric, 0),
              'quantity', COALESCE(NULLIF(x->>'quantity', '')::numeric, 0),
              'taxType', v_tax_type) ORDER BY o), '[]'::jsonb)
       FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(x, o)),
    v_rate, 'fixed', v_discount, public.app_max_discount_percent());
  v_total := (v_doc->>'total')::numeric;
  v_tax_amount := (v_doc->>'tax')::numeric;
  v_discount := (v_doc->>'discountGross')::numeric;
  v_taxable := (v_doc->>'subtotal')::numeric;
  -- The rate as a fraction, like every other order (P1.2).
  v_tax_rate_stored := v_rate;

  v_paid := GREATEST(COALESCE(NULLIF(p_order->>'paid_amount', '')::numeric, 0), 0);
  IF v_paid > v_total THEN
    RAISE EXCEPTION 'المبلغ المدفوع (%) أكبر من إجمالي الطلب (%)', v_paid, v_total USING ERRCODE = '22023';
  END IF;

  -- The order number only. allocate_tenant_sale_numbers would also consume an
  -- invoice number, and this order has no invoice yet.
  INSERT INTO public.tenant_order_counters (tenant_id) VALUES (v_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;
  UPDATE public.tenant_order_counters t
     SET next_order_number = t.next_order_number + 1
   WHERE t.tenant_id = v_tenant
  RETURNING t.next_order_number - 1 INTO v_order_number;

  -- paid_amount starts at 0: the deposit, if any, goes through
  -- record_order_payment below so there is one payment rule in the system.
  INSERT INTO public.orders (
    id, tenant_id, branch_id, customer_id, customer_name, order_number,
    status, status_key, payment_method, total_amount, paid_amount,
    tax_rate, tax_amount, discount_amount, order_date, delivery_date,
    qr_code, images, notes, created_by, is_test, assigned_tailor_id, kind
  ) VALUES (
    p_operation_id, v_tenant, v_branch, v_customer_id, v_customer_name, v_order_number,
    v_status, v_status_key, v_method, v_total, 0,
    v_tax_rate_stored, v_tax_amount, v_discount, now(),
    COALESCE(NULLIF(p_order->>'delivery_date', '')::timestamptz, now()),
    'tailor-order-' || p_operation_id::text,
    CASE WHEN jsonb_typeof(p_order->'images') = 'array' THEN p_order->'images' ELSE '[]'::jsonb END,
    NULLIF(p_order->>'notes', ''), v_staff,
    COALESCE((p_order->>'is_test')::boolean, false), v_tailor, 'tailoring'
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_idx := v_idx + 1;
    v_fabric_id := NULLIF(v_item->>'fabric_id', '')::uuid;
    -- Only cloth from stock carries a figure to deduct at cutting.
    v_consumed := CASE WHEN v_fabric_id IS NULL THEN 0
                       ELSE COALESCE(NULLIF(v_item->>'consumed_meters', '')::numeric, 0) END;
    INSERT INTO public.order_items (
      tenant_id, order_id, type, name, garment_type, fabric, fabric_id,
      quantity, price, consumed_meters, status, status_key,
      collar_type, cuff_type, pocket_type, chest_style, shoulder_style, cutting_type,
      collar_padding, closure_type, closure_visibility,
      additions, embroidery, attributes, measurements,
      tax_type, line_net, line_tax, line_discount
    ) VALUES (
      v_tenant, p_operation_id, 'custom', v_item->>'garment_type', v_item->>'garment_type',
      NULLIF(v_item->>'fabric', ''), v_fabric_id,
      (v_item->>'quantity')::numeric, COALESCE(NULLIF(v_item->>'price', '')::numeric, 0),
      v_consumed, v_status, v_status_key,
      NULLIF(v_item->>'collar_type', ''), NULLIF(v_item->>'cuff_type', ''),
      NULLIF(v_item->>'pocket_type', ''), NULLIF(v_item->>'chest_style', ''),
      NULLIF(v_item->>'shoulder_style', ''), NULLIF(v_item->>'cutting_type', ''),
      NULLIF(v_item->>'collar_padding', '')::collar_padding,
      NULLIF(v_item->>'closure_type', '')::closure_type,
      NULLIF(v_item->>'closure_visibility', '')::closure_visibility,
      NULLIF(v_item->>'additions', ''), NULLIF(v_item->>'embroidery', ''),
      CASE WHEN jsonb_typeof(v_item->'attributes') = 'object' THEN v_item->'attributes' ELSE '{}'::jsonb END,
      -- The customer's measurements as they are now: a later edit to the
      -- customer must not change what this order was cut to.
      v_measurements,
      v_doc->'lines'->(v_idx - 1)->>'taxType',
      (v_doc->'lines'->(v_idx - 1)->>'netAfter')::numeric,
      (v_doc->'lines'->(v_idx - 1)->>'taxAfter')::numeric,
      (v_doc->'lines'->(v_idx - 1)->>'discount')::numeric
    );
  END LOOP;

  INSERT INTO public.order_history (tenant_id, order_id, status, notes, updated_by_staff, updated_by_name)
  VALUES (v_tenant, p_operation_id, v_status, NULLIF(coalesce(p_order->>'history_note', '') || public.app_offline_note(), ''), v_staff, COALESCE(v_staff_name, 'Staff'));

  -- Deposit: needs the caller's own open shift, so the till sees it. Without
  -- one the order is still saved and the deposit is left for the order screen.
  IF v_paid > 0 THEN
    SELECT id INTO v_shift FROM public.shifts
     WHERE tenant_id = v_tenant AND staff_id = v_staff AND status = 'open'
     ORDER BY start_time DESC LIMIT 1;
    IF v_shift IS NULL THEN
      v_deposit_skipped := true;
    ELSE
      PERFORM public.record_order_payment(
        md5('tailoring-deposit:' || p_operation_id::text)::uuid,
        p_operation_id, v_paid, v_method, v_shift,
        NULLIF(p_order->>'deposit_note', ''), NULL, NULL
      );
    END IF;
  END IF;

  SELECT to_jsonb(o) INTO v_order FROM public.orders o WHERE o.id = p_operation_id;

  v_result := jsonb_build_object(
    'order', v_order,
    'deposit_skipped', v_deposit_skipped,
    'replayed', false
  );

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'create_tailoring_order', v_result);

  RETURN v_result;
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

CREATE OR REPLACE FUNCTION public.issue_tax_invoice_for_order(p_operation_id uuid, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- P4 (OPERATIONS-01): the automatic issue on delivery or full payment
  -- (app_auto_issue_tax_invoice) is the system's own act, not the employee's;
  -- it sets seen.auto_invoice for its own call only.
  IF current_setting('seen.auto_invoice', true) IS DISTINCT FROM 'on'
     AND NOT (public.app_has_permission('invoices.view') AND public.app_has_permission('reports.tax')) THEN
    RAISE EXCEPTION 'إصدار الفاتورة الضريبية يتطلب صلاحية الفواتير' USING ERRCODE = '42501';
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
END $function$;

CREATE OR REPLACE FUNCTION public.confirm_referral(p_referred_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r referrals%ROWTYPE;
BEGIN
  -- SECURITY-04: only the subscription trigger (or the server) confirms a
  -- referral, and only once the referred shop is actually paying.
  IF public.app_is_client_call() AND pg_trigger_depth() = 0 THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_referred_tenant AND t.subscription_status = 'active') THEN
    RETURN;
  END IF;
  SELECT * INTO r FROM referrals WHERE referred_tenant_id = p_referred_tenant AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  -- S-23: a partner referral recorded earlier for the same shop takes the reward.
  IF EXISTS (SELECT 1 FROM partner_referrals p WHERE p.referred_tenant_id = p_referred_tenant
              AND p.status IN ('pending', 'credited') AND p.created_at < r.created_at) THEN
    UPDATE referrals SET status = 'expired' WHERE id = r.id;
    RETURN;
  END IF;
  IF now() <= r.qualified_until THEN
    UPDATE referrals SET status='credited', credited_at=now() WHERE id = r.id;
    INSERT INTO referral_wallets(tenant_id, balance, total_earned, updated_at)
      VALUES (r.referrer_tenant_id, r.reward_amount, r.reward_amount, now())
      ON CONFLICT (tenant_id) DO UPDATE
        SET balance = referral_wallets.balance + r.reward_amount,
            total_earned = referral_wallets.total_earned + r.reward_amount, updated_at = now();
  ELSE
    UPDATE referrals SET status='expired' WHERE id = r.id;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.confirm_partner_referral(p_referred_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r partner_referrals%ROWTYPE;
BEGIN
  -- SECURITY-04: only the subscription trigger (or the server) confirms a
  -- referral, and only once the referred shop is actually paying.
  IF public.app_is_client_call() AND pg_trigger_depth() = 0 THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_referred_tenant AND t.subscription_status = 'active') THEN
    RETURN;
  END IF;
  SELECT * INTO r FROM partner_referrals WHERE referred_tenant_id = p_referred_tenant AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  -- S-23: a shop's referral recorded first (or at the same time) takes the reward.
  IF EXISTS (SELECT 1 FROM referrals x WHERE x.referred_tenant_id = p_referred_tenant
              AND x.status IN ('pending', 'credited') AND x.created_at <= r.created_at) THEN
    UPDATE partner_referrals SET status = 'expired' WHERE id = r.id;
    RETURN;
  END IF;
  IF now() <= r.qualified_until THEN
    UPDATE partner_referrals SET status='credited', credited_at=now() WHERE id = r.id;
    INSERT INTO partner_wallets(partner_id, balance, total_earned, updated_at)
      VALUES (r.partner_id, r.reward_amount, r.reward_amount, now())
      ON CONFLICT (partner_id) DO UPDATE
        SET balance = partner_wallets.balance + r.reward_amount,
            total_earned = partner_wallets.total_earned + r.reward_amount, updated_at = now();
  ELSE
    UPDATE partner_referrals SET status='expired' WHERE id = r.id;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.permanently_delete_tenant(p_tenant_id uuid, p_confirm_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name       TEXT;
  v_trashed_at TIMESTAMPTZ;
BEGIN
  IF NOT public.app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT name, trashed_at INTO v_name, v_trashed_at FROM public.tenants WHERE id = p_tenant_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'التاجر غير موجود' USING ERRCODE = '42501';
  END IF;
  IF v_trashed_at IS NULL THEN
    RAISE EXCEPTION 'يجب نقل التاجر لسلة المهملات أولاً قبل الحذف النهائي' USING ERRCODE = '22023';
  END IF;
  IF v_name IS DISTINCT FROM p_confirm_name THEN
    RAISE EXCEPTION 'الاسم المُدخل لا يطابق اسم التاجر' USING ERRCODE = '22023';
  END IF;
  -- P5 (PLATFORM-08): an export taken after the shop went to the trash, first.
  IF NOT EXISTS (SELECT 1 FROM public.tenant_data_exports e WHERE e.tenant_id = p_tenant_id AND e.created_at >= v_trashed_at) THEN
    RAISE EXCEPTION 'صدّر بيانات المحل أولاً: يلزم تصدير بعد نقله إلى سلة المهملات' USING ERRCODE = '22023';
  END IF;
  -- ...and its tax documents are kept, apart from the shop, for the legal period.
  INSERT INTO public.tax_document_archive (tenant_id, tenant_name, kind, document_id, issued_at, document, retain_until)
  SELECT p_tenant_id, v_name, 'invoice', ti.id, ti.created_at, to_jsonb(ti), (ti.created_at + interval '6 years')::date
    FROM public.tax_invoices ti WHERE ti.tenant_id = p_tenant_id
  ON CONFLICT (kind, document_id) DO NOTHING;
  INSERT INTO public.tax_document_archive (tenant_id, tenant_name, kind, document_id, issued_at, document, retain_until)
  SELECT p_tenant_id, v_name, 'credit_note', sr.id, sr.created_at,
         to_jsonb(sr) || jsonb_build_object('items', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM public.sales_return_items i WHERE i.return_id = sr.id), '[]'::jsonb)),
         (sr.created_at + interval '6 years')::date
    FROM public.sales_returns sr WHERE sr.tenant_id = p_tenant_id
  ON CONFLICT (kind, document_id) DO NOTHING;
  -- P6 (PLATFORM-09): logged here, before the row goes -- the browser's own
  -- log line pointed at the deleted shop and was refused by its foreign key.
  PERFORM public.saas_log_admin_action('permanently_delete_tenant', format('tenant %s (%s), trashed %s, tax documents archived: %s',
    p_tenant_id, v_name, v_trashed_at, (SELECT count(*) FROM public.tax_document_archive WHERE tenant_id = p_tenant_id)));
  -- S-41: rows in tables without a cascading key to tenants go with it
  -- (children first). Kept: the tax archive and the export record, which
  -- must outlive the shop, and sales leads, which are the platform's.
  DELETE FROM public.adjustment_items WHERE tenant_id::text = p_tenant_id::text;
  DELETE FROM public.inventory_adjustments WHERE tenant_id::text = p_tenant_id::text;
  DELETE FROM public.uom_conversion_logs WHERE tenant_id::text = p_tenant_id::text;
  DELETE FROM public.item_uom_conversions WHERE tenant_id::text = p_tenant_id::text;
  DELETE FROM public.fabric_uoms WHERE tenant_id::text = p_tenant_id::text;
  DELETE FROM public.stock_operations WHERE tenant_id::text = p_tenant_id::text;
  DELETE FROM public.sales_notifications WHERE tenant_id::text = p_tenant_id::text;
  DELETE FROM public.assistant_tool_calls WHERE tenant_id::text = p_tenant_id::text;
  DELETE FROM public.assistant_usage_daily WHERE tenant_id::text = p_tenant_id::text;
  DELETE FROM public.tailor_requests WHERE tenant_id::text = p_tenant_id::text;
  DELETE FROM public.tenants WHERE id = p_tenant_id;
END $function$;
