-- Hardening of the tailoring order path before it reaches production, from
-- the full team review of 2026-11-19 (مراجعة-الفريق-التقني-الكامل-2026-11-19.md).
--
--   1. orders.create had no server default, so create_tailoring_order refused
--      every caller but the owner unless their role row named the key.
--   2. create_tailoring_order took the order's stage from the browser.
--   3. Two concurrent copies of one save could collide on the primary key.
--   4. update_order_status_with_fabric took fabric quantities from the browser
--      with no upper bound, and for older orders with no tie to the order.
--   5. fabric_deducted_at was set even when nothing had been deducted.
--   6. An order delivered straight from the payment dialog never had its
--      fabric deducted (record_order_payment changes the stage itself).
--
-- Every function keeps its signature. Nothing here touches existing rows.

-- -----------------------------------------------------------------------
-- 1) orders.create in the default matrix: the roles the client's
--    DEFAULT_ROLES already show the "new order" button to (admin, manager,
--    branch_manager, cashier). The rest of the matrix is unchanged from
--    20261205000000.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_default_permission(p_role TEXT, p_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN CASE p_role
    WHEN 'admin' THEN
      CASE p_permission_key
        WHEN 'orders.create' THEN true
        WHEN 'payments.collect' THEN true
        WHEN 'action.refund' THEN true
        WHEN 'action.discount' THEN true
        WHEN 'orders.delete' THEN true
        WHEN 'customers.delete' THEN true
        WHEN 'inventory.delete' THEN true
        WHEN 'staff.permissions' THEN true
        WHEN 'settings.billing' THEN false
        WHEN 'suppliers.manage' THEN true
        WHEN 'inventory.reconcile' THEN true
        WHEN 'shifts.manage' THEN true
        ELSE false
      END
    WHEN 'manager' THEN
      CASE p_permission_key
        WHEN 'orders.create' THEN true
        WHEN 'payments.collect' THEN true
        WHEN 'action.refund' THEN true
        WHEN 'action.discount' THEN true
        WHEN 'orders.delete' THEN true
        WHEN 'customers.delete' THEN true
        WHEN 'inventory.delete' THEN true
        WHEN 'staff.permissions' THEN false
        WHEN 'settings.billing' THEN false
        WHEN 'suppliers.manage' THEN true
        WHEN 'inventory.reconcile' THEN true
        WHEN 'shifts.manage' THEN true
        ELSE false
      END
    WHEN 'branch_manager' THEN
      CASE p_permission_key
        WHEN 'orders.create' THEN true
        WHEN 'payments.collect' THEN true
        WHEN 'action.refund' THEN true
        WHEN 'action.discount' THEN true
        WHEN 'orders.delete' THEN false
        WHEN 'customers.delete' THEN false
        WHEN 'inventory.delete' THEN false
        WHEN 'staff.permissions' THEN false
        WHEN 'settings.billing' THEN false
        WHEN 'suppliers.manage' THEN true
        WHEN 'inventory.reconcile' THEN true
        WHEN 'shifts.manage' THEN true
        ELSE false
      END
    WHEN 'accountant' THEN
      CASE p_permission_key
        WHEN 'payments.collect' THEN false
        WHEN 'action.refund' THEN true
        WHEN 'action.discount' THEN false
        WHEN 'orders.delete' THEN false
        WHEN 'customers.delete' THEN false
        WHEN 'inventory.delete' THEN false
        WHEN 'staff.permissions' THEN false
        WHEN 'settings.billing' THEN false
        WHEN 'suppliers.manage' THEN true
        WHEN 'inventory.reconcile' THEN false
        WHEN 'shifts.manage' THEN false
        ELSE false
      END
    WHEN 'warehouse_manager' THEN
      CASE p_permission_key
        WHEN 'payments.collect' THEN false
        WHEN 'action.refund' THEN false
        WHEN 'action.discount' THEN false
        WHEN 'orders.delete' THEN false
        WHEN 'customers.delete' THEN false
        WHEN 'inventory.delete' THEN true
        WHEN 'staff.permissions' THEN false
        WHEN 'settings.billing' THEN false
        WHEN 'suppliers.manage' THEN true
        WHEN 'inventory.reconcile' THEN true
        WHEN 'shifts.manage' THEN false
        ELSE false
      END
    WHEN 'cashier' THEN
      CASE p_permission_key
        WHEN 'orders.create' THEN true
        WHEN 'payments.collect' THEN true
        WHEN 'action.refund' THEN false
        WHEN 'action.discount' THEN true
        WHEN 'orders.delete' THEN false
        WHEN 'customers.delete' THEN false
        WHEN 'inventory.delete' THEN false
        WHEN 'staff.permissions' THEN false
        WHEN 'settings.billing' THEN false
        WHEN 'suppliers.manage' THEN false
        WHEN 'inventory.reconcile' THEN false
        WHEN 'shifts.manage' THEN true
        ELSE false
      END
    WHEN 'tailor' THEN false
    ELSE false
  END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.app_default_permission(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------
-- 2 + 3) create_tailoring_order: the stage is fixed at creation, and the
--        idempotency check is serialised per operation id.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_tailoring_order(
  p_operation_id UUID,
  p_order        JSONB,
  p_items        JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  v_legacy          text;
  v_meta            jsonb;
  v_tax_settings    jsonb;
  v_vat_number      text;
  v_tax_enabled     boolean;
  v_tax_type        text;
  v_rate_pct        numeric;
  v_rate            numeric;
  v_tax_amount      numeric := 0;
  v_total           numeric;
  v_tax_rate_stored numeric := 0;

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

  v_staff := public.app_current_staff_id();
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
    IF COALESCE(NULLIF(v_item->>'consumed_meters', '')::numeric, 0) < 0 THEN
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
  v_discount := LEAST(v_discount, v_items_total);
  v_taxable := v_items_total - v_discount;

  -- Tailoring tax, the same rules the Orders page applied in the browser
  -- (resolveTailoringTax + calculateItemTax): enabled follows the stored flag,
  -- else whether the shop has a VAT number; the rate defaults to 15 and the
  -- type to exclusive.
  -- The settings are not a column: the shop's tax settings are a JSON
  -- document kept in tenants.legacy_id, which the client's fetch layer
  -- exposes as `tax_settings` (either under that key or as the whole
  -- document). Read it the same way; anything unreadable means "no settings".
  SELECT legacy_id, vat_number INTO v_legacy, v_vat_number
    FROM public.tenants WHERE id = v_tenant;
  v_tax_settings := NULL;
  IF v_legacy LIKE '{%' THEN
    BEGIN
      v_meta := v_legacy::jsonb;
      v_tax_settings := CASE WHEN jsonb_typeof(v_meta->'tax_settings') = 'object'
                             THEN v_meta->'tax_settings' ELSE v_meta END;
    EXCEPTION WHEN OTHERS THEN
      v_tax_settings := NULL;
    END;
  END IF;
  IF v_tax_settings IS NULL OR jsonb_typeof(v_tax_settings) <> 'object' THEN
    v_tax_enabled := COALESCE(btrim(v_vat_number), '') <> '';
    v_tax_type := 'exclusive';
    v_rate_pct := 15;
  ELSE
    v_tax_enabled := COALESCE(
      (v_tax_settings->>'enabled')::boolean,
      COALESCE(btrim(v_vat_number), '') <> '' OR COALESCE(v_tax_settings->>'trn', '') <> ''
    );
    v_tax_type := COALESCE(NULLIF(v_tax_settings->>'tailoringTaxType', ''), 'exclusive');
    v_rate_pct := COALESCE(NULLIF(v_tax_settings->>'vatRate', '')::numeric, 15);
    IF v_rate_pct = 0 THEN v_rate_pct := 15; END IF;
  END IF;
  v_rate := v_rate_pct / 100;

  IF NOT v_tax_enabled OR v_tax_type = 'exempt' THEN
    v_tax_amount := 0;
    v_total := round(v_taxable, 2);
    v_tax_rate_stored := 0;
  ELSIF v_tax_type = 'inclusive' THEN
    v_tax_amount := round(v_taxable - v_taxable / (1 + v_rate), 2);
    v_total := round(v_taxable, 2);
    v_tax_rate_stored := v_rate_pct;
  ELSE
    v_tax_amount := round(v_taxable * v_rate, 2);
    v_total := round(v_taxable + v_taxable * v_rate, 2);
    v_tax_rate_stored := v_rate_pct;
  END IF;

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
    v_fabric_id := NULLIF(v_item->>'fabric_id', '')::uuid;
    -- Only cloth from stock carries a figure to deduct at cutting.
    v_consumed := CASE WHEN v_fabric_id IS NULL THEN 0
                       ELSE COALESCE(NULLIF(v_item->>'consumed_meters', '')::numeric, 0) END;
    INSERT INTO public.order_items (
      tenant_id, order_id, type, name, garment_type, fabric, fabric_id,
      quantity, price, consumed_meters, status, status_key,
      collar_type, cuff_type, pocket_type, chest_style, shoulder_style, cutting_type,
      collar_padding, closure_type, closure_visibility,
      additions, embroidery, attributes, measurements
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
      v_measurements
    );
  END LOOP;

  INSERT INTO public.order_history (tenant_id, order_id, status, notes, updated_by_staff, updated_by_name)
  VALUES (v_tenant, p_operation_id, v_status, NULLIF(p_order->>'history_note', ''), v_staff, COALESCE(v_staff_name, 'Staff'));

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
END $$;

REVOKE EXECUTE ON FUNCTION public.create_tailoring_order(UUID, JSONB, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_tailoring_order(UUID, JSONB, JSONB) TO authenticated;

-- -----------------------------------------------------------------------
-- 5) deduct_order_fabric: stamp the order only after a real deduction, and
--    take the lines in a fixed order.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deduct_order_fabric(
  p_order_id UUID,
  p_lines    JSONB DEFAULT NULL
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant    uuid;
  v_staff     uuid;
  v_branch    uuid;
  v_order_br  uuid;
  v_done      timestamptz;
  v_strategy  text;
  v_line      record;
  v_count     integer := 0;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT branch_id, fabric_deducted_at INTO v_order_br, v_done
    FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_done IS NOT NULL THEN
    RETURN 0;
  END IF;

  FOR v_line IN
    SELECT l.line_key, l.fabric_id, l.meters
      FROM (
        SELECT oi.id::text AS line_key, oi.fabric_id, COALESCE(oi.consumed_meters, 0) AS meters
          FROM public.order_items oi
         WHERE p_lines IS NULL
           AND oi.order_id = p_order_id AND oi.tenant_id = v_tenant
           AND oi.type = 'custom' AND oi.fabric_id IS NOT NULL
        UNION ALL
        SELECT x->>'line_key', NULLIF(x->>'fabric_id', '')::uuid,
               COALESCE(NULLIF(x->>'meters', '')::numeric, 0)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_lines) = 'array' THEN p_lines ELSE '[]'::jsonb END) x
      ) l
     WHERE l.fabric_id IS NOT NULL AND l.meters > 0
     -- A fixed order, so two orders drawing on the same cloths lock the stock
     -- rows the same way round and cannot deadlock each other.
     ORDER BY l.fabric_id, l.line_key
  LOOP
    IF v_line.line_key IS NULL OR btrim(v_line.line_key) = '' THEN
      RAISE EXCEPTION 'line_key مطلوب لكل سطر قماش' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.inventory_items WHERE id = v_line.fabric_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- Resolved on first need, so an order with nothing to deduct never fails
    -- for lack of a branch.
    IF v_branch IS NULL THEN
      SELECT inventory_strategy INTO v_strategy FROM public.tenants WHERE id = v_tenant;
      IF COALESCE(v_strategy, 'centralized') = 'centralized' THEN
        SELECT id INTO v_branch FROM public.branches
         WHERE tenant_id = v_tenant AND is_main = true LIMIT 1;
        IF v_branch IS NULL THEN
          RAISE EXCEPTION 'المستودع الرئيسي غير موجود' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_staff := public.app_current_staff_id();
        v_branch := COALESCE(v_order_br, (SELECT branch_id FROM public.staff WHERE id = v_staff));
        IF v_branch IS NULL THEN
          RAISE EXCEPTION 'لم يُحدَّد فرع لخصم القماش' USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;

    PERFORM public.apply_stock_movement(
      'order:' || p_order_id::text || ':line:' || v_line.line_key,
      v_branch, v_line.fabric_id, -abs(v_line.meters), 'deduction', p_order_id, 'order'
    );
    v_count := v_count + 1;
  END LOOP;

  -- Only a real deduction closes the order to further ones. An order whose
  -- lines carried no figure yet stays open, so the figure can still be
  -- entered and deducted at a later stage.
  IF v_count > 0 THEN
    UPDATE public.orders SET fabric_deducted_at = now() WHERE id = p_order_id;
  END IF;
  RETURN v_count;
END $$;

REVOKE EXECUTE ON FUNCTION public.deduct_order_fabric(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------
-- 4) update_order_status_with_fabric: the reviewed quantities are bounded,
--    tied to the order, and any change from the saved figure is written to
--    the order's history.
--
--    The person at the cutting table may correct a figure -- that is the
--    point of the dialog -- so this is not put behind a separate permission.
--    The bound is 15 m per piece (a thobe takes about 4), enough for any
--    real correction and far short of emptying a roll onto one order.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_order_status_with_fabric(
  p_order_id      UUID,
  p_status        TEXT,
  p_status_key    TEXT,
  p_fabric_lines  JSONB,
  p_notes         TEXT DEFAULT NULL,
  p_op_id         UUID DEFAULT NULL,
  p_history_note  TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager', 'cashier', 'tailor') THEN
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

      PERFORM public.deduct_order_fabric(p_order_id, p_fabric_lines);
    END IF;
  END IF;

  IF v_changes <> '' THEN
    v_note := COALESCE(NULLIF(p_history_note, '') || ' | ', '') || 'تعديل كمية القماش عند القص: ' || v_changes;
  END IF;

  RETURN public.update_order_status(p_order_id, p_status, p_status_key, p_notes, p_op_id, v_note);
END $$;

REVOKE EXECUTE ON FUNCTION public.update_order_status_with_fabric(UUID, TEXT, TEXT, JSONB, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_order_status_with_fabric(UUID, TEXT, TEXT, JSONB, TEXT, UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------
-- 6) A safety net for every other way an order's stage can change.
--
--    update_order_status deducts explicitly and strictly: short stock aborts
--    the move. But record_order_payment moves an order to "delivered" itself
--    when the balance is settled, and a row can also be updated directly.
--    This trigger deducts on any such change. It never blocks one: taking a
--    customer's payment must not fail because the stock count is short, so a
--    deduction that cannot be made is left pending (fabric_deducted_at stays
--    NULL) and recorded in the order's history.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_deduct_fabric_on_stage()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff uuid;
BEGIN
  -- No signed-in caller (a service-role write): nothing to attribute the
  -- stock movement to. Leave the deduction pending.
  IF public.app_current_tenant_id() IS DISTINCT FROM NEW.tenant_id THEN
    RETURN NULL;
  END IF;

  BEGIN
    PERFORM public.deduct_order_fabric(NEW.id, NULL);
  EXCEPTION WHEN check_violation OR insufficient_privilege OR invalid_parameter_value THEN
    v_staff := public.app_current_staff_id();
    INSERT INTO public.order_history (tenant_id, order_id, status, notes, updated_by_staff, updated_by_name)
    VALUES (NEW.tenant_id, NEW.id, NEW.status, 'تعذّر خصم القماش تلقائياً: ' || SQLERRM, v_staff,
            COALESCE((SELECT name FROM public.staff WHERE id = v_staff), 'Staff'));
  END;
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.orders_deduct_fabric_on_stage() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_deduct_fabric_on_stage ON public.orders;
CREATE TRIGGER trg_orders_deduct_fabric_on_stage
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (
    NEW.kind = 'tailoring'
    AND NEW.fabric_deducted_at IS NULL
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status >= 'cutting'::order_status
    AND NEW.status <> 'cancelled'::order_status
  )
  EXECUTE FUNCTION public.orders_deduct_fabric_on_stage();
