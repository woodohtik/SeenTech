-- seen-readiness-fixes-task.md P4 (OPERATIONS-01) -- a tailoring order's tax
-- invoice is issued by itself.
--
-- Before: a tailoring order was delivered and paid in full with no tax
-- invoice unless someone with the invoices permission pressed "issue" later.
--
-- Now: when a tailoring order becomes delivered, or fully paid, and the shop
-- is tax-registered with its seller name and VAT number set, its simplified
-- tax invoice is issued in the same transaction (issue_tax_invoice_for_order
-- -- one rule, one numbering). It is then stamped and queued for ZATCA
-- (P2). Nothing here can stop the delivery or the payment: a failure to
-- issue is logged to order_history and the manual button still works.
-- A deposit's own invoice (ZATCA-13) is left for the founder's tax adviser.
-- Rollback: supabase/rollbacks/20270105_auto_tax_invoice.down.sql

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
     AND NOT public.app_has_permission('invoices.view') THEN
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
END $function$
;


CREATE OR REPLACE FUNCTION public.app_auto_issue_tax_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tax_on boolean;
  v_name   text;
  v_trn    text;
BEGIN
  IF NEW.kind IS DISTINCT FROM 'tailoring' OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  -- Only at the moment it becomes delivered or fully paid.
  IF NOT ((NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered')
          OR (round(COALESCE(NEW.total_amount, 0) - COALESCE(NEW.paid_amount, 0), 2) <= 0
              AND round(COALESCE(OLD.total_amount, 0) - COALESCE(OLD.paid_amount, 0), 2) > 0)) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tax_invoices WHERE order_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  SELECT is_tax_enabled, name, vat_number INTO v_tax_on, v_name, v_trn FROM public.tenants WHERE id = NEW.tenant_id;
  IF NOT COALESCE(v_tax_on, false) OR COALESCE(v_name, '') = '' OR COALESCE(v_trn, '') = '' THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM set_config('seen.auto_invoice', 'on', true);
    PERFORM public.issue_tax_invoice_for_order(gen_random_uuid(), NEW.id);
    PERFORM set_config('seen.auto_invoice', 'off', true);
  EXCEPTION WHEN others THEN
    PERFORM set_config('seen.auto_invoice', 'off', true);
    INSERT INTO public.order_history (tenant_id, order_id, status, notes, updated_by_name)
    VALUES (NEW.tenant_id, NEW.id, NEW.status, 'تعذّر إصدار الفاتورة الضريبية تلقائياً: ' || SQLERRM, 'System');
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.app_auto_issue_tax_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_auto_tax_invoice ON public.orders;
CREATE TRIGGER orders_auto_tax_invoice AFTER UPDATE OF status, paid_amount ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.app_auto_issue_tax_invoice();
