-- Rollback of 20270124000002_order_occasion.sql: both functions as they were.
-- The columns stay (dropping them would lose the occasions entered since).
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


CREATE OR REPLACE FUNCTION public.update_tailoring_order(p_operation_id uuid, p_order_id uuid, p_changes jsonb, p_items jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant      uuid := public.app_current_tenant_id();
  v_staff       uuid;
  v_staff_name  text;
  v_op_key      text;
  v_existing    jsonb;
  v_order       record;
  v_changes     jsonb := COALESCE(p_changes, '{}'::jsonb);
  v_reason      text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_notes       text[] := '{}';
  v_delivery    timestamptz;
  v_tailor      uuid;
  v_new_notes   text;
  v_tax_enabled boolean;
  v_tax_type    text;
  v_rate_pct    numeric;
  v_rate        numeric;
  v_discount    numeric;
  v_doc         jsonb;
  v_total       numeric;
  v_measure     jsonb;
  v_item        jsonb;
  v_idx         int := 0;
  v_fabric_id   uuid;
  v_result      jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.app_has_permission('orders.edit') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل الطلبات' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'update_tailoring_order:' || p_operation_id::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_op_key, 0));
  SELECT result INTO v_existing FROM public.stock_operations WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_staff := public.app_actor_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_order.kind IS DISTINCT FROM 'tailoring' THEN
    RAISE EXCEPTION 'يُعدَّل من هنا طلب التفصيل فقط' USING ERRCODE = '22023';
  END IF;
  IF v_order.status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'لا يُعدَّل طلب تم تسليمه أو إلغاؤه' USING ERRCODE = '22023';
  END IF;

  -- Always allowed: delivery date, tailor, notes.
  IF v_changes ? 'delivery_date' THEN
    BEGIN
      v_delivery := NULLIF(v_changes->>'delivery_date', '')::timestamptz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'موعد التسليم غير صالح' USING ERRCODE = '22023';
    END;
    IF v_delivery IS NULL THEN
      RAISE EXCEPTION 'موعد التسليم مطلوب' USING ERRCODE = '22023';
    END IF;
    IF v_delivery IS DISTINCT FROM v_order.delivery_date THEN
      UPDATE public.orders SET delivery_date = v_delivery WHERE id = p_order_id;
      v_notes := v_notes || ('موعد التسليم: ' || to_char(v_delivery AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD'));
    END IF;
  END IF;

  IF v_changes ? 'assigned_tailor_id' THEN
    v_tailor := NULLIF(v_changes->>'assigned_tailor_id', '')::uuid;
    IF v_tailor IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.staff WHERE id = v_tailor AND tenant_id = v_tenant AND status = 'active') THEN
      RAISE EXCEPTION 'الخياط غير موجود في هذا المحل' USING ERRCODE = '22023';
    END IF;
    IF v_tailor IS DISTINCT FROM v_order.assigned_tailor_id THEN
      UPDATE public.orders SET assigned_tailor_id = v_tailor WHERE id = p_order_id;
      v_notes := v_notes || ('الخياط: ' || COALESCE((SELECT name FROM public.staff WHERE id = v_tailor), 'بلا خياط'));
    END IF;
  END IF;

  IF v_changes ? 'notes' THEN
    v_new_notes := NULLIF(btrim(COALESCE(v_changes->>'notes', '')), '');
    -- A B2B order keeps its metadata; only the free text inside it changes.
    IF v_order.notes LIKE '__B2B_METADATA__:%' THEN
      v_new_notes := '__B2B_METADATA__:' || jsonb_set(
        substr(v_order.notes, length('__B2B_METADATA__:') + 1)::jsonb, '{originalNotes}', to_jsonb(COALESCE(v_new_notes, '')))::text;
    END IF;
    IF v_new_notes IS DISTINCT FROM v_order.notes THEN
      UPDATE public.orders SET notes = v_new_notes WHERE id = p_order_id;
      v_notes := v_notes || 'الملاحظات'::text;
    END IF;
  END IF;

  -- The lines: before cutting, and before any tax invoice.
  IF p_items IS NOT NULL THEN
    IF v_order.fabric_deducted_at IS NOT NULL THEN
      RAISE EXCEPTION 'بعد القص يمكن تعديل موعد التسليم والخياط والملاحظات فقط' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.tax_invoices WHERE order_id = p_order_id) THEN
      RAISE EXCEPTION 'للطلب فاتورة ضريبية -- يُعدَّل مبلغه بإشعار دائن لا بالتعديل' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'الطلب يحتاج صنفاً واحداً على الأقل' USING ERRCODE = '22023';
    END IF;

    v_discount := v_order.discount_amount;
    IF v_changes ? 'discount_amount' THEN
      v_discount := GREATEST(COALESCE(NULLIF(v_changes->>'discount_amount', '')::numeric, 0), 0);
      IF v_discount IS DISTINCT FROM COALESCE(v_order.discount_amount, 0) AND NOT public.app_has_permission('action.discount') THEN
        RAISE EXCEPTION 'لا تملك صلاحية الخصم' USING ERRCODE = '42501';
      END IF;
    END IF;

    SELECT r.enabled, r.tax_type, r.rate_pct INTO v_tax_enabled, v_tax_type, v_rate_pct
      FROM public.tenant_tax_rules(v_tenant) r;
    v_rate := CASE WHEN v_tax_enabled AND v_tax_type <> 'exempt' THEN v_rate_pct / 100 ELSE 0 END;
    v_doc := public.app_tax_document(
      (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'price', COALESCE(NULLIF(x->>'price', '')::numeric, 0),
                'quantity', COALESCE(NULLIF(x->>'quantity', '')::numeric, 0),
                'taxType', v_tax_type) ORDER BY o), '[]'::jsonb)
         FROM jsonb_array_elements(p_items) WITH ORDINALITY AS t(x, o)),
      v_rate, 'fixed', COALESCE(v_discount, 0), public.app_max_discount_percent());
    v_total := (v_doc->>'total')::numeric;

    IF v_total < COALESCE(v_order.paid_amount, 0) THEN
      RAISE EXCEPTION 'الإجمالي الجديد (%) أقل مما دُفع (%)', v_total, v_order.paid_amount USING ERRCODE = '22023';
    END IF;
    IF v_total IS DISTINCT FROM v_order.total_amount AND (v_reason IS NULL OR length(v_reason) < 3) THEN
      RAISE EXCEPTION 'تغيير مبلغ الطلب يحتاج سبباً' USING ERRCODE = '22023';
    END IF;

    -- The order's measurements as they were taken (not the customer's current ones).
    SELECT measurements INTO v_measure FROM public.order_items WHERE order_id = p_order_id ORDER BY created_at, id LIMIT 1;
    DELETE FROM public.order_items WHERE order_id = p_order_id;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_idx := v_idx + 1;
      v_fabric_id := NULLIF(v_item->>'fabric_id', '')::uuid;
      INSERT INTO public.order_items (
        tenant_id, order_id, type, name, garment_type, fabric, fabric_id,
        quantity, price, consumed_meters, status, status_key,
        collar_type, cuff_type, pocket_type, chest_style, shoulder_style, cutting_type,
        collar_padding, closure_type, closure_visibility,
        additions, embroidery, attributes, measurements,
        tax_type, line_net, line_tax, line_discount
      ) VALUES (
        v_tenant, p_order_id, 'custom', v_item->>'garment_type', v_item->>'garment_type',
        NULLIF(v_item->>'fabric', ''), v_fabric_id,
        (v_item->>'quantity')::numeric, COALESCE(NULLIF(v_item->>'price', '')::numeric, 0),
        CASE WHEN v_fabric_id IS NULL THEN 0 ELSE COALESCE(NULLIF(v_item->>'consumed_meters', '')::numeric, 0) END,
        v_order.status, v_order.status_key,
        NULLIF(v_item->>'collar_type', ''), NULLIF(v_item->>'cuff_type', ''),
        NULLIF(v_item->>'pocket_type', ''), NULLIF(v_item->>'chest_style', ''),
        NULLIF(v_item->>'shoulder_style', ''), NULLIF(v_item->>'cutting_type', ''),
        NULLIF(v_item->>'collar_padding', '')::collar_padding,
        NULLIF(v_item->>'closure_type', '')::closure_type,
        NULLIF(v_item->>'closure_visibility', '')::closure_visibility,
        NULLIF(v_item->>'additions', ''), NULLIF(v_item->>'embroidery', ''),
        CASE WHEN jsonb_typeof(v_item->'attributes') = 'object' THEN v_item->'attributes' ELSE '{}'::jsonb END,
        COALESCE(CASE WHEN jsonb_typeof(v_item->'measurements') = 'object' THEN v_item->'measurements' END, v_measure, '{}'::jsonb),
        v_doc->'lines'->(v_idx - 1)->>'taxType',
        (v_doc->'lines'->(v_idx - 1)->>'netAfter')::numeric,
        (v_doc->'lines'->(v_idx - 1)->>'taxAfter')::numeric,
        (v_doc->'lines'->(v_idx - 1)->>'discount')::numeric
      );
    END LOOP;

    UPDATE public.orders
       SET total_amount = v_total, tax_amount = (v_doc->>'tax')::numeric,
           discount_amount = (v_doc->>'discountGross')::numeric, tax_rate = v_rate
     WHERE id = p_order_id;
    v_notes := v_notes || ('الأصناف' || CASE WHEN v_total IS DISTINCT FROM v_order.total_amount
                             THEN ' — الإجمالي من ' || v_order.total_amount::text || ' إلى ' || v_total::text ELSE '' END);
  END IF;

  IF array_length(v_notes, 1) IS NULL THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'changed', '[]'::jsonb);
  END IF;

  INSERT INTO public.order_history (tenant_id, order_id, status, notes, updated_by_staff, updated_by_name)
  VALUES (v_tenant, p_order_id, v_order.status,
          'تعديل: ' || array_to_string(v_notes, '، ') || COALESCE(' — السبب: ' || v_reason, ''),
          v_staff, COALESCE(v_staff_name, 'System'));

  v_result := jsonb_build_object('order_id', p_order_id, 'changed', to_jsonb(v_notes),
    'total', (SELECT total_amount FROM public.orders WHERE id = p_order_id));
  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'update_tailoring_order', v_result);
  RETURN v_result;
END;
$function$;

