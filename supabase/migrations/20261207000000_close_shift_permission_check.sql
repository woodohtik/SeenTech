-- Task 3 of docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md:
-- close_shift's cross-staff close gate now checks shifts.manage via
-- app_has_permission() instead of the hard-coded owner/admin/manager role list.
-- Only that one IF condition changes; the rest of the function body is copied
-- verbatim from 20261128000000_shift_cash_single_source_of_truth.sql.

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

  IF v_staff IS DISTINCT FROM v_shift_staff AND NOT public.app_has_permission('shifts.manage') THEN
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
