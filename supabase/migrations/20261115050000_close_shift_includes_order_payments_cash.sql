-- seen-cto-code-review-2026-11-13.md C9's closing point: "custom/
-- tailoring orders have no shift_id, so their payments never enter a
-- till's cash reconciliation." record_order_payment (previous migration)
-- now writes a real `payments` row with shift_id when the caller
-- supplies an open shift -- but close_shift (sprint-1 item 3) only ever
-- summed orders.paid_amount where orders.shift_id = the shift being
-- closed. A custom order's shift_id is always NULL (Orders.tsx has no
-- shift-context plumbing), so that cash was still invisible to
-- close_shift even after item 5's fix. This migration makes close_shift
-- also sum cash from the `payments` table by shift_id.
--
-- No double-counting risk: create_pos_sale (the only other path that
-- sets orders.paid_amount) never writes to `payments` at all, and
-- record_order_payment is the only writer to `payments` -- the two
-- sums cover disjoint sets of cash movements.
--
-- totalSales/taxes/discounts/orderCount/productBreakdown stay
-- orders-table-only, as in the original close_shift migration: a custom
-- order's sale total was never attributed to any shift's Z-report sales
-- figures (orders.shift_id is NULL for them, full stop) and fixing that
-- is a larger, separate change to how custom-order sales get attributed
-- to a shift/day at all, not in scope for C9's "payments get lost" fix.

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
  v_order_payments_cash numeric;
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

  SELECT
    COALESCE(SUM(paid_amount) FILTER (WHERE payment_method = 'cash'), 0),
    COALESCE(SUM(paid_amount) FILTER (WHERE payment_method = 'network'), 0),
    COALESCE(SUM(paid_amount) FILTER (WHERE payment_method = 'bank_transfer'), 0),
    COALESCE(SUM(paid_amount) FILTER (WHERE payment_method IN ('cash_on_delivery', 'partial')), 0),
    COALESCE(SUM(total_amount), 0),
    COALESCE(SUM(tax_amount), 0),
    COALESCE(SUM(discount_amount), 0),
    COUNT(*)
  INTO v_cash, v_card, v_bank_transfer, v_credit, v_total_sales, v_tax_amount, v_discount_amount, v_order_count
  FROM public.orders
  WHERE shift_id = p_shift_id AND tenant_id = v_tenant AND status <> 'cancelled';

  -- seen-cto-code-review-2026-11-13.md C9: cash collected against an
  -- order that itself has no shift_id (every custom/tailoring order --
  -- record_order_payment is the only writer of this table).
  SELECT COALESCE(SUM(amount) FILTER (WHERE method = 'cash'), 0)
    INTO v_order_payments_cash
    FROM public.payments
   WHERE shift_id = p_shift_id AND tenant_id = v_tenant;

  v_cash := v_cash + v_order_payments_cash;

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
