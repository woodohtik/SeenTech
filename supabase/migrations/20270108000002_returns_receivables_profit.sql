-- seen-readiness-fixes-task.md P6 (MONEY-13, MONEY-14) -- returns, what a
-- customer owes, and net profit.
--
--  * A return's credit note is the full returned value (it was capped at
--    what had been paid, so returning goods from an unpaid credit sale made
--    a credit note of zero). The cash given back stays capped by what was
--    paid; the rest goes to orders.credited_amount, and
--    orders.remaining_amount = total - paid - credited, so every screen that
--    shows what a customer owes is right without changing it.
--    credited_amount is written by the server only.
--    check_sales_return_total now caps the credit notes' value at the
--    invoice's total (it summed the cash refunds).
--  * shift_entries.source: manual | supplier_payment | order_refund. Older
--    rows are classified by the reasons those functions write; new ones by
--    a trigger, and record_cash_movement always writes 'manual'.
--  * get_tenant_financial_summary: returns come off revenue and output tax
--    ('returns' in the result); operating expenses are manual payouts only
--    (a supplier payment is in the cost of goods already, a cancelled
--    order's refund is out of revenue already) and follow the branch.
--  * dashboard_order_rows leaves out cancelled and test orders.
-- Needs PostgreSQL 17 (ALTER COLUMN ... SET EXPRESSION).
-- Rollback: supabase/rollbacks/20270108_returns_receivables_profit.down.sql

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS credited_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.orders ALTER COLUMN remaining_amount SET EXPRESSION AS (total_amount - paid_amount - credited_amount);

CREATE OR REPLACE FUNCTION public.orders_guard_credited_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.credited_amount := 0;
  ELSIF NEW.credited_amount IS DISTINCT FROM OLD.credited_amount THEN
    RAISE EXCEPTION 'لا يُعدَّل رصيد الإشعارات الدائنة للطلب إلا عبر المرتجع' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS orders_guard_credited_amount ON public.orders;
CREATE TRIGGER orders_guard_credited_amount BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_guard_credited_amount();

CREATE OR REPLACE FUNCTION public.check_sales_return_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_total numeric;
  v_prior_sum     numeric;
BEGIN
  IF NEW.invoice_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.invoice_id::text));
  SELECT total_amount INTO v_invoice_total FROM public.tax_invoices WHERE id = NEW.invoice_id;
  IF v_invoice_total IS NULL THEN
    RETURN NEW;
  END IF;
  -- P6 (MONEY-13): the credit notes' value, not the cash refunded.
  SELECT COALESCE(SUM(total_amount), 0) INTO v_prior_sum
  FROM public.sales_returns
  WHERE invoice_id = NEW.invoice_id AND id IS DISTINCT FROM NEW.id;
  IF v_prior_sum + COALESCE(NEW.total_amount, 0) > v_invoice_total + 0.01 THEN
    RAISE EXCEPTION 'مجموع الاسترجاعات/إشعارات الدائن لهذه الفاتورة (%) يتجاوز إجماليها (%)',
      v_prior_sum + NEW.total_amount, v_invoice_total USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER TABLE public.shift_entries ADD COLUMN IF NOT EXISTS source text
  CHECK (source IS NULL OR source IN ('manual', 'supplier_payment', 'order_refund'));
UPDATE public.shift_entries SET source = CASE
    WHEN reason LIKE 'سند صرف رقم %' THEN 'supplier_payment'
    WHEN reason LIKE 'رد مبلغ طلب ملغى #%' THEN 'order_refund'
    ELSE 'manual' END
 WHERE source IS NULL;

CREATE OR REPLACE FUNCTION public.shift_entries_set_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.source IS NULL THEN
    NEW.source := CASE
      WHEN NEW.reason LIKE 'سند صرف رقم %' THEN 'supplier_payment'
      WHEN NEW.reason LIKE 'رد مبلغ طلب ملغى #%' THEN 'order_refund'
      ELSE 'manual' END;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS shift_entries_set_source ON public.shift_entries;
CREATE TRIGGER shift_entries_set_source BEFORE INSERT ON public.shift_entries
FOR EACH ROW EXECUTE FUNCTION public.shift_entries_set_source();

CREATE OR REPLACE FUNCTION public.record_cash_movement(
  p_operation_id uuid, p_shift_id uuid, p_kind text, p_amount numeric, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := app_current_tenant_id();
  v_actor  uuid := app_actor_staff_id();
  v_shift  record;
  v_entry  record;
BEGIN
  IF v_tenant IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'معرّف العملية مطلوب' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_entry FROM public.shift_entries WHERE id = p_operation_id;
  IF v_entry.id IS NOT NULL THEN
    IF v_entry.tenant_id <> v_tenant THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('entry_id', v_entry.id, 'replayed', true);
  END IF;
  IF p_kind NOT IN ('deposit', 'payout') THEN
    RAISE EXCEPTION 'نوع العملية غير صالح' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000 THEN
    RAISE EXCEPTION 'المبلغ غير صالح' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'السبب مطلوب' USING ERRCODE = '22023';
  END IF;

  SELECT id, tenant_id, staff_id, status INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF v_shift.id IS NULL OR v_shift.tenant_id <> v_tenant THEN
    RAISE EXCEPTION 'الوردية غير موجودة' USING ERRCODE = '42501';
  END IF;
  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'الوردية مغلقة: لا إيداع ولا سحب عليها' USING ERRCODE = '22023';
  END IF;
  IF v_shift.staff_id IS DISTINCT FROM v_actor AND NOT app_has_permission('shifts.manage') THEN
    RAISE EXCEPTION 'لا تملك صلاحية الإيداع أو السحب في وردية موظف آخر' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.shift_entries (id, tenant_id, shift_id, entry_type, amount, reason, occurred_at, created_by, created_at, source)
  VALUES (p_operation_id, v_tenant, p_shift_id, p_kind::public.shift_entry_type, round(p_amount, 2), btrim(p_reason), now(), v_actor, now(), 'manual');
  RETURN jsonb_build_object('entry_id', p_operation_id, 'replayed', false);
END;
$function$;

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
END $function$
;

CREATE OR REPLACE FUNCTION public.get_tenant_financial_summary(p_tenant_id uuid, p_date_from date, p_date_to date, p_branch_id uuid DEFAULT NULL::uuid, p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_tenant UUID;
  v_start         TIMESTAMPTZ;
  v_end           TIMESTAMPTZ;
  v_revenue       NUMERIC;
  v_tax           NUMERIC;
  v_order_count   BIGINT;
  v_expenses      NUMERIC;
  v_returns       NUMERIC;
  v_returns_tax   NUMERIC;
BEGIN
  v_caller_tenant := public.app_current_tenant_id();
  IF v_caller_tenant IS NULL OR v_caller_tenant <> p_tenant_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- p_date_from/p_date_to are Riyadh calendar dates (what a "من/إلى" date
  -- picker in the UI means) -- converting them AT TIME ZONE 'Asia/Riyadh'
  -- treats the plain timestamp as Riyadh wall-clock time and yields the
  -- correct UTC instant for midnight Riyadh, not midnight UTC. The upper
  -- bound is exclusive (midnight Riyadh the day AFTER p_date_to), so a
  -- sale at 23:59 Riyadh on the last day of the range is still included.
  v_start := p_date_from::timestamp AT TIME ZONE 'Asia/Riyadh';
  v_end   := (p_date_to + 1)::timestamp AT TIME ZONE 'Asia/Riyadh';

  SELECT COALESCE(SUM(o.total_amount), 0), COALESCE(SUM(o.tax_amount), 0), COUNT(*)
    INTO v_revenue, v_tax, v_order_count
    FROM public.orders o
   WHERE o.tenant_id = p_tenant_id
     AND o.status <> 'cancelled'
     AND o.order_date >= v_start AND o.order_date < v_end
     AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
     AND (p_staff_id IS NULL OR o.created_by = p_staff_id);

  -- Operating expenses: cash payouts logged against shifts -- the only
  -- tenant-wide expense ledger this system tracks outside supplier
  -- purchases (there is no `expenses` table; see the sprint 2 dashboard
  -- fixes commit for where that was being silently read as always-empty).
  -- P6 (MONEY-13): returns in the period come off revenue and output tax.
  SELECT COALESCE(SUM(sr.total_amount), 0),
         COALESCE(SUM(sr.total_amount - ROUND(sr.total_amount / (1 + COALESCE(o.tax_rate, 0)), 2)), 0)
    INTO v_returns, v_returns_tax
    FROM public.sales_returns sr
    JOIN public.orders o ON o.id = sr.order_id
   WHERE sr.tenant_id = p_tenant_id
     AND sr.returned_at >= v_start AND sr.returned_at < v_end
     AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
     AND (p_staff_id IS NULL OR o.created_by = p_staff_id);
  v_revenue := v_revenue - v_returns;
  v_tax := v_tax - v_returns_tax;

  -- P6 (MONEY-14): operating expenses are the drawer's manual payouts only --
  -- a supplier payment is already in the cost of goods, and a cancelled
  -- order's refund is already out of revenue -- and they follow the branch.
  SELECT COALESCE(SUM(se.amount), 0) INTO v_expenses
    FROM public.shift_entries se
    LEFT JOIN public.shifts sh ON sh.id = se.shift_id
   WHERE se.tenant_id = p_tenant_id
     AND se.entry_type = 'payout'
     AND COALESCE(se.source, 'manual') = 'manual'
     AND se.occurred_at >= v_start AND se.occurred_at < v_end
     AND (p_branch_id IS NULL OR sh.branch_id = p_branch_id);

  -- seen-permissions-fix-task.md Phase 5: the money only for whoever may see
  -- revenue (null, not an error, so a shared screen still loads).
  IF NOT (public.app_has_permission('dashboard.revenue') OR public.app_has_permission('reports.financial')) THEN
    v_revenue := NULL; v_tax := NULL; v_expenses := NULL; v_returns := NULL;
  END IF;

  RETURN jsonb_build_object(
    'revenue', v_revenue,
    'tax', v_tax,
    'order_count', v_order_count,
    'operating_expenses', v_expenses,
    'returns', v_returns,
    'date_from', p_date_from,
    'date_to', p_date_to
  );
END; $function$
;

CREATE OR REPLACE FUNCTION public.dashboard_order_rows(p_tenant_id uuid, p_branch_id uuid)
 RETURNS TABLE(customer_id text, at timestamp with time zone, status text, paid numeric, remaining numeric, notes text, phase text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(o.customer_id::text, ''), coalesce(o.order_date, now()),
         coalesce(o.status_key, o.status::text), coalesce(o.paid_amount, 0)::numeric,
         coalesce(o.remaining_amount, 0)::numeric, o.notes,
         public.order_phase(t.vertical, o.status_key, o.status::text)
    FROM public.orders o
    LEFT JOIN public.tenants t ON t.id = o.tenant_id
   WHERE o.tenant_id = p_tenant_id
     AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
     -- P6 (MONEY-13): cancelled and test orders are not the shop's business.
     AND o.status::text <> 'cancelled'
     AND NOT COALESCE(o.is_test, false);
$function$
;
