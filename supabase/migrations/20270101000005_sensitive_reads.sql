-- seen-permissions-fix-task.md Phase 5: sensitive reads checked on the server.
--
--  * get_tenant_financial_summary: revenue, tax and expenses are null for
--    whoever has neither dashboard.revenue nor reports.financial (the order
--    count stays) -- null, not an error, so a screen that shows both still
--    loads.
--  * get_dashboard_stats: the amounts (paid per range, paid / remaining for
--    the period) likewise; the order and customer counts stay.
--  * get_tenant_customers_page: customers.view.
--  * record_order_payment: settling and delivering in one call also needs
--    orders.update_status (Phase 4 found the gap).
--
-- Not done here, on purpose (the task: no permission check in SELECT
-- policies of large tables, see seen-scalability-task.md): the customers,
-- orders and tax_invoices tables stay readable by the whole shop. The VAT
-- report and the customer export are computed in the browser from them, so
-- reports.tax / reports.export gate those screens only.
-- Rollback: supabase/rollbacks/20270101_sensitive_reads.down.sql

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
  SELECT COALESCE(SUM(se.amount), 0) INTO v_expenses
    FROM public.shift_entries se
   WHERE se.tenant_id = p_tenant_id
     AND se.entry_type = 'payout'
     AND se.occurred_at >= v_start AND se.occurred_at < v_end;

  -- seen-permissions-fix-task.md Phase 5: the money only for whoever may see
  -- revenue (null, not an error, so a shared screen still loads).
  IF NOT (public.app_has_permission('dashboard.revenue') OR public.app_has_permission('reports.financial')) THEN
    v_revenue := NULL; v_tax := NULL; v_expenses := NULL;
  END IF;

  RETURN jsonb_build_object(
    'revenue', v_revenue,
    'tax', v_tax,
    'order_count', v_order_count,
    'operating_expenses', v_expenses,
    'date_from', p_date_from,
    'date_to', p_date_to
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_tenant_id uuid, p_branch_id uuid DEFAULT NULL::uuid, p_ranges jsonb DEFAULT '[]'::jsonb, p_filter jsonb DEFAULT NULL::jsonb, p_active_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ranges jsonb;
  v_filtered jsonb;
  v_totals jsonb;
  v_low_stock int;
  v_done text[];
  f_s timestamptz;
  f_e timestamptz;
  f_inc boolean;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(coalesce(p_ranges, '[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(p_ranges, '[]'::jsonb)) > 200 THEN
    RAISE EXCEPTION 'p_ranges must be an array of at most 200 ranges' USING ERRCODE = '22023';
  END IF;

  IF p_filter IS NOT NULL THEN
    f_s := (p_filter ->> 's')::timestamptz;
    f_e := (p_filter ->> 'e')::timestamptz;
    f_inc := coalesce((p_filter ->> 'inc')::boolean, true);
  END IF;

  -- The vertical's ready / delivered stage keys (+ the enum's, as before).
  SELECT ARRAY['delivered', 'ready'] || coalesce(array_agg(s.stage_key), ARRAY[]::text[])
    INTO v_done
    FROM public.tenants t
    JOIN public.vertical_workflow_stages s ON s.vertical_key = t.vertical
   WHERE t.id = p_tenant_id AND s.phase IN ('ready', 'delivered');

  -- Per requested range: orders, money taken, still-open orders, new
  -- customers. One pass over the orders and one over the customers.
  WITH rg AS (
    SELECT x.ord, (x.v ->> 's')::timestamptz AS s, (x.v ->> 'e')::timestamptz AS e,
           coalesce((x.v ->> 'inc')::boolean, false) AS inc
      FROM jsonb_array_elements(coalesce(p_ranges, '[]'::jsonb)) WITH ORDINALITY AS x(v, ord)
  ),
  d AS MATERIALIZED (
    SELECT at, phase, paid FROM public.dashboard_order_rows(p_tenant_id, p_branch_id)
  ),
  ro AS (
    SELECT rg.ord, count(d.at) AS orders, coalesce(sum(d.paid), 0) AS paid,
           count(d.at) FILTER (WHERE d.phase NOT IN ('delivered', 'ready')) AS pending
      FROM rg LEFT JOIN d ON d.at >= rg.s AND (d.at < rg.e OR (rg.inc AND d.at = rg.e))
     GROUP BY rg.ord
  ),
  rc AS (
    SELECT rg.ord, count(c.id) AS customers
      FROM rg LEFT JOIN public.customers c
        ON c.tenant_id = p_tenant_id AND c.created_at IS NOT NULL
       AND c.created_at >= rg.s AND (c.created_at < rg.e OR (rg.inc AND c.created_at = rg.e))
     GROUP BY rg.ord
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'orders', ro.orders, 'paid', ro.paid, 'pending', ro.pending, 'customers', rc.customers
         ) ORDER BY ro.ord), '[]'::jsonb)
    INTO v_ranges
    FROM ro JOIN rc ON rc.ord = ro.ord;

  -- The selected period (or all time): the cards' figures.
  WITH f AS MATERIALIZED (
    SELECT * FROM public.dashboard_order_rows(p_tenant_id, p_branch_id) d
     WHERE p_filter IS NULL OR (d.at >= f_s AND (d.at < f_e OR (f_inc AND d.at = f_e)))
  ),
  done AS (
    SELECT f.at, public.dashboard_order_completed_at(f.notes, v_done) AS done_at
      FROM f WHERE f.phase IN ('delivered', 'ready')
  ),
  per_customer AS (
    SELECT f.customer_id, count(*) AS n FROM f WHERE f.customer_id <> '' GROUP BY f.customer_id
  )
  SELECT jsonb_build_object(
    'orders', (SELECT count(*) FROM f),
    'paid', (SELECT coalesce(sum(paid), 0) FROM f),
    'remaining', (SELECT coalesce(sum(remaining), 0) FROM f),
    'pending', (SELECT count(*) FROM f WHERE phase NOT IN ('delivered', 'ready')),
    'customers', (SELECT count(*) FROM public.customers c
                   WHERE c.tenant_id = p_tenant_id
                     AND (p_filter IS NULL
                          OR (c.created_at IS NOT NULL AND c.created_at >= f_s
                              AND (c.created_at < f_e OR (f_inc AND c.created_at = f_e))))),
    'completion_hours', (SELECT coalesce(sum(extract(epoch FROM (done_at - at)) / 3600.0), 0)
                           FROM done WHERE done_at > at),
    'completion_count', (SELECT count(*) FROM done WHERE done_at > at),
    'active_customers', (SELECT count(DISTINCT customer_id) FROM f
                          WHERE p_active_since IS NULL OR at >= p_active_since),
    'customers_with_orders', (SELECT count(*) FROM per_customer),
    'repeat_customers', (SELECT count(*) FROM per_customer WHERE n > 1),
    'status_counts', (SELECT coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
                        FROM (SELECT status, count(*) AS n FROM f GROUP BY status) s)
  ) INTO v_filtered;

  -- Whole-history figures the page shows regardless of the period.
  SELECT jsonb_build_object(
    'orders', count(*),
    'in_progress', count(*) FILTER (WHERE phase NOT IN ('delivered', 'ready', 'cancelled')),
    'measurements_taken', count(*) FILTER (WHERE phase = 'received'),
    'ready', count(*) FILTER (WHERE phase = 'ready')
  ) INTO v_totals FROM public.dashboard_order_rows(p_tenant_id, p_branch_id);

  SELECT count(*) INTO v_low_stock
    FROM public.inventory_items i
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(bi.quantity), 0) AS qty
        FROM public.branch_inventory bi
       WHERE bi.item_id = i.id AND bi.tenant_id = p_tenant_id
    ) q ON true
   WHERE i.tenant_id = p_tenant_id
     AND q.qty <= coalesce(i.min_threshold, 0);

  -- seen-permissions-fix-task.md Phase 5: amounts taken / still due only for
  -- whoever may see revenue; the counts stay.
  IF NOT (public.app_has_permission('dashboard.revenue') OR public.app_has_permission('reports.financial')) THEN
    SELECT coalesce(jsonb_agg(r.v || jsonb_build_object('paid', NULL) ORDER BY r.ord), '[]'::jsonb)
      INTO v_ranges
      FROM jsonb_array_elements(coalesce(v_ranges, '[]'::jsonb)) WITH ORDINALITY AS r(v, ord);
    v_filtered := coalesce(v_filtered, '{}'::jsonb) || jsonb_build_object('paid', NULL, 'remaining', NULL);
  END IF;

  RETURN jsonb_build_object(
    'ranges', v_ranges,
    'filtered', v_filtered,
    'totals', v_totals,
    'low_stock', v_low_stock,
    'customers_total', (SELECT count(*) FROM public.customers c WHERE c.tenant_id = p_tenant_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_tenant_customers_page(p_tenant_id uuid, p_page integer, p_page_size integer, p_search text DEFAULT NULL::text, p_category_filter text DEFAULT 'all'::text, p_balance_filter text DEFAULT 'all'::text, p_sort_by text DEFAULT 'date_desc'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_tenant UUID;
  v_offset        INT;
  v_search        TEXT;
  v_result        JSONB;
BEGIN
  v_caller_tenant := public.app_current_tenant_id();
  IF v_caller_tenant IS NULL OR v_caller_tenant <> p_tenant_id
     OR NOT public.app_has_permission('customers.view') THEN  -- Phase 5
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_offset := p_page * p_page_size;
  v_search := NULLIF(trim(COALESCE(p_search, '')), '');

  WITH balances AS (
    SELECT o.customer_id,
           SUM(o.remaining_amount) AS balance,
           COUNT(*) AS order_count,
           SUM(o.total_amount) AS total_purchases
      FROM public.orders o
     WHERE o.tenant_id = p_tenant_id
       AND o.status <> 'cancelled'
       AND o.customer_id IS NOT NULL
     GROUP BY o.customer_id
  ),
  filtered AS (
    SELECT c.id, c.name, c.phone, c.email, c.measurements, c.styles, c.notes,
           c.is_test, c.company_name, c.vat_number, c.measurements_token,
           c.created_at, c.updated_at,
           COALESCE(b.balance, 0) AS balance,
           COALESCE(b.order_count, 0) AS order_count,
           COALESCE(b.total_purchases, 0) AS total_purchases
      FROM public.customers c
      LEFT JOIN balances b ON b.customer_id = c.id
     WHERE c.tenant_id = p_tenant_id
       AND (
         v_search IS NULL
         OR c.name ILIKE '%' || v_search || '%'
         OR c.phone ILIKE '%' || v_search || '%'
         OR c.company_name ILIKE '%' || v_search || '%'
         OR c.vat_number ILIKE '%' || v_search || '%'
         OR (c.styles->>'city') ILIKE '%' || v_search || '%'
       )
       AND (
         p_category_filter IS NULL OR p_category_filter = 'all'
         OR (p_category_filter = 'measurements' AND EXISTS (
               SELECT 1 FROM jsonb_each_text(c.measurements) e
                WHERE e.value IS NOT NULL AND e.value <> '' AND e.value <> '0'))
         OR (p_category_filter = 'recent' AND c.created_at >= now() - interval '7 days')
         OR (p_category_filter = 'test' AND c.is_test)
         OR (p_category_filter = 'b2b' AND COALESCE(c.company_name, '') <> '')
         OR (p_category_filter = 'b2c' AND COALESCE(c.company_name, '') = '')
       )
       AND (
         p_balance_filter IS NULL OR p_balance_filter = 'all'
         OR (p_balance_filter = 'debtor' AND COALESCE(b.balance, 0) > 0)
         OR (p_balance_filter = 'creditor' AND COALESCE(b.balance, 0) < 0)
         OR (p_balance_filter = 'balanced' AND COALESCE(b.balance, 0) = 0)
       )
  ),
  paged AS (
    SELECT *, count(*) OVER() AS total_count
      FROM filtered
     ORDER BY
       CASE WHEN p_sort_by = 'name' THEN name END ASC,
       CASE WHEN p_sort_by = 'date_asc' THEN created_at END ASC,
       CASE WHEN p_sort_by = 'balance_desc' THEN balance END DESC,
       CASE WHEN p_sort_by NOT IN ('name', 'date_asc', 'balance_desc') THEN created_at END DESC
     LIMIT p_page_size OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(jsonb_agg(to_jsonb(paged) - 'total_count'), '[]'::jsonb),
    'total', COALESCE(MAX(total_count), (SELECT count(*) FROM filtered))
  ) INTO v_result
  FROM paged;

  RETURN v_result;
END; $function$;

CREATE OR REPLACE FUNCTION public.record_order_payment(p_operation_id uuid, p_order_id uuid, p_amount numeric, p_method payment_method, p_shift_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_complete_status text DEFAULT NULL::text, p_complete_status_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- seen-permissions-fix-task.md Phase 3: taking money needs payments.collect.
  IF NOT public.app_has_permission('payments.collect') THEN
    RAISE EXCEPTION 'لا تملك صلاحية استلام دفعة' USING ERRCODE = '42501';
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
  -- seen-permissions-fix-task.md Phase 5: settling and delivering in one step
  -- also changes the order's status, which needs orders.update_status.
  IF p_complete_status IS NOT NULL AND NOT public.app_has_permission('orders.update_status') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل حالة الطلب' USING ERRCODE = '42501';
  END IF;
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
END $function$;
