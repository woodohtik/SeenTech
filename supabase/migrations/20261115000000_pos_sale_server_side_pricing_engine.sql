-- seen-cto-code-review-2026-11-13.md, سبرنت 1، البند 1 (POS-01 / C5).
-- Read cto-review-2026-11-13/07-pos-sales.md's full POS-01/POS-19/POS-07
-- entries first.
--
-- Until now create_pos_sale trusted every money figure the browser sent:
-- it only cross-checked the client's own subtotal against the client's own
-- item prices (self-referential), never looked an item's real price up in
-- the catalog, applied no discount cap, accepted an arbitrary branch_id/
-- shift_id with no server-side check that the shift was even open, and
-- order_number/invoice_number were client Date.now()-based despite the
-- orders.order_number column's own DDL comment claiming "per-tenant
-- sequential". Any authenticated staff member (cashier included) could
-- devtools-call this RPC with a 500 SAR item priced at 1 SAR and a 100%
-- discount, and a real, hash-chained tax invoice would be issued for it.
--
-- Fix (founder-confirmed): server looks up each ready_made item's real
-- price from inventory_items/inventory_variants (ignores whatever price
-- the client sent for those lines -- custom/bespoke tailoring lines still
-- take their price from the tailor, since there is no catalog price for a
-- made-to-order garment); discount is capped server-side by role (cashier
-- 10%, manager 25%, owner/admin unlimited); a FIXED discount amount is
-- VAT-inclusive (reduces the customer's final total by exactly that
-- amount, not the pre-tax base -- closes the "10 SAR off actually removes
-- 11.50" mismatch); paid_amount > total is rejected with a clear message
-- instead of a raw CHECK-constraint crash; order_number/invoice_number are
-- now allocated from a real per-tenant counter; a sale requires the
-- caller's own currently-open shift and derives branch_id from it (not
-- from the client) instead of accepting NULL/anything and silently
-- skipping stock deduction.
--
-- NOT in scope here (separate, pre-existing issues, flagged in
-- seen-cto-sprint1-financial-engine-task.md, not silently fixed):
-- - Per-item tax type (inclusive/exclusive/exempt): there is no DB column
--   for it anywhere in the schema despite the TS type/UI implying one
--   exists -- ProductFormFields.tsx's tax-type picker is never persisted.
--   Every item has only ever actually behaved as 'exclusive' in practice.
--   This migration keeps that single-rate-per-sale reality (tenant-wide
--   is_tax_enabled/default_tax_rate) rather than inventing a half-wired
--   per-item feature as a side effect of this fix.
-- - close_shift/approve_stock_take/process_sales_return/record_order_payment
--   rebuilds: separate task-file items, not touched by this migration.

-- Per-tenant counters for order_number/invoice_number -- replaces the
-- client Date.now()-based numbers (POS-19) with a real, gapless-per-tenant
-- sequence. Seeded from each tenant's current MAX so existing order
-- numbers are never reused, and new numbers for an existing tenant keep
-- looking like they're continuing upward instead of suddenly resetting.
CREATE TABLE IF NOT EXISTS public.tenant_order_counters (
  tenant_id            UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  next_order_number    BIGINT NOT NULL DEFAULT 1,
  next_invoice_number  BIGINT NOT NULL DEFAULT 1
);

INSERT INTO public.tenant_order_counters (tenant_id, next_order_number, next_invoice_number)
SELECT t.id,
       COALESCE((SELECT MAX(o.order_number) FROM public.orders o WHERE o.tenant_id = t.id), 0) + 1,
       COALESCE((SELECT COUNT(*) FROM public.tax_invoices ti WHERE ti.tenant_id = t.id), 0) + 1
  FROM public.tenants t
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE public.tenant_order_counters ENABLE ROW LEVEL SECURITY;
-- No policies: this table is only ever touched by SECURITY DEFINER
-- functions (create_pos_sale and whatever future RPCs allocate numbers),
-- never directly by a client -- matches stock_operations' own convention.
REVOKE ALL ON public.tenant_order_counters FROM PUBLIC, anon, authenticated;

-- Allocates and returns the next order_number/invoice_number for a
-- tenant, atomically (row lock via UPDATE ... RETURNING). SECURITY
-- DEFINER so it works from inside create_pos_sale regardless of caller
-- grants on tenant_order_counters.
CREATE OR REPLACE FUNCTION public.allocate_tenant_sale_numbers(p_tenant UUID)
RETURNS TABLE(order_number BIGINT, invoice_number BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.tenant_order_counters (tenant_id)
  VALUES (p_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;

  RETURN QUERY
  UPDATE public.tenant_order_counters t
     SET next_order_number = t.next_order_number + 1,
         next_invoice_number = t.next_invoice_number + 1
   WHERE t.tenant_id = p_tenant
  RETURNING t.next_order_number - 1, t.next_invoice_number - 1;
END $$;

REVOKE EXECUTE ON FUNCTION public.allocate_tenant_sale_numbers(UUID) FROM PUBLIC, anon, authenticated;

-- Server-side discount ceiling by role, matching the founder's own
-- decision (cashier 10%, manager 25%, owner/admin unlimited). NULL means
-- "no cap". A role not listed here (tailor, accountant, branch_manager,
-- warehouse_manager, or any future role) gets the conservative cashier
-- default rather than silently inheriting "unlimited".
CREATE OR REPLACE FUNCTION public.app_max_discount_percent()
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE public.app_current_role()
    WHEN 'owner' THEN NULL
    WHEN 'admin' THEN NULL
    WHEN 'manager' THEN 25
    ELSE 10
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.app_max_discount_percent() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_max_discount_percent() TO authenticated;

-- Server-side port of src/lib/zatca.ts's toTLV/generateZatcaQR (single-byte
-- tag, single-byte length, matching the client's own TextEncoder-based
-- encoder byte for byte). Needed because the QR must now be built from the
-- server's own authoritative total/tax -- the client can no longer compute
-- them before calling create_pos_sale, since the whole point of this
-- migration is that those numbers are not known until the server computes
-- them. Not a ZATCA Phase 2 compliance rebuild (that's a separate, larger
-- item -- C12 in seen-cto-code-review-2026-11-13.md -- needing XAdES
-- signing/ICV/C14N and a specialist decision); this only moves the exact
-- same QR the app already generated from the client to the server, so it
-- can use real numbers.
CREATE OR REPLACE FUNCTION public.zatca_qr_tlv(p_tag INT, p_value TEXT)
RETURNS BYTEA LANGUAGE sql IMMUTABLE AS $$
  SELECT set_byte(set_byte('\x0000'::bytea, 0, p_tag), 1, length(convert_to(COALESCE(p_value, ''), 'UTF8')))
         || convert_to(COALESCE(p_value, ''), 'UTF8');
$$;

CREATE OR REPLACE FUNCTION public.zatca_qr_payload(
  p_seller_name TEXT, p_trn TEXT, p_timestamp TIMESTAMPTZ, p_total TEXT, p_vat_amount TEXT
)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(
    public.zatca_qr_tlv(1, p_seller_name) ||
    public.zatca_qr_tlv(2, p_trn) ||
    public.zatca_qr_tlv(3, to_char(p_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS."000Z"')) ||
    public.zatca_qr_tlv(4, p_total) ||
    public.zatca_qr_tlv(5, p_vat_amount),
    'base64'
  );
$$;

-- Full create_pos_sale rewrite. Signature unchanged (p_operation_id,
-- p_order, p_items, p_invoice) so this redeploys over the existing
-- function cleanly; only the *meaning* of several JSON fields changes
-- (documented per-field below) -- the client is updated in the same
-- deploy (src/components/POS.tsx) to match.
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
  );

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
GRANT  EXECUTE ON FUNCTION public.create_pos_sale(UUID,JSONB,JSONB,JSONB) TO authenticated;
