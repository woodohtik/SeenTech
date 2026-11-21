-- Rollback of 20270101000003_permissions_transfer_shift_measurements.sql.
CREATE OR REPLACE FUNCTION public.transfer_ship_item(p_operation_id text, p_transfer_id uuid, p_from_branch uuid, p_item_id uuid, p_qty numeric)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.apply_stock_movement(
    p_operation_id, p_from_branch, p_item_id, -abs(p_qty),
    'transfer_out', p_transfer_id, 'stock_transfer');
$function$;

CREATE OR REPLACE FUNCTION public.transfer_receive_item(p_operation_id text, p_transfer_id uuid, p_to_branch uuid, p_item_id uuid, p_qty numeric)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.apply_stock_movement(
    p_operation_id, p_to_branch, p_item_id, abs(p_qty),
    'transfer_in', p_transfer_id, 'stock_transfer');
$function$;

CREATE OR REPLACE FUNCTION public.open_shift(p_operation_id uuid, p_opening_balance numeric, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant      uuid;
  v_staff       uuid;
  v_staff_name  text;
  v_op_key      text;
  v_existing    jsonb;
  v_shift_id    uuid;
  v_existing_open uuid;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار فتح الوردية' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'open_shift:' || p_operation_id::text;
  SELECT result INTO v_existing FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;

  -- If this staff member already has an open shift (double-tap, or simply
  -- forgot it was open), return that one instead of failing on the unique
  -- index -- matches the review's own fix note ("open via RPC returning
  -- existing open shift if any").
  SELECT id INTO v_existing_open FROM public.shifts
   WHERE tenant_id = v_tenant AND staff_id = v_staff AND status = 'open'
   LIMIT 1;
  IF v_existing_open IS NOT NULL THEN
    RETURN jsonb_build_object('shift_id', v_existing_open, 'already_open', true, 'replayed', false);
  END IF;

  INSERT INTO public.shifts (tenant_id, branch_id, staff_id, staff_name, opening_balance, status, start_time)
  VALUES (v_tenant, p_branch_id, v_staff, COALESCE(v_staff_name, 'Staff'), GREATEST(COALESCE(p_opening_balance, 0), 0), 'open', now())
  RETURNING id INTO v_shift_id;

  BEGIN
    INSERT INTO public.employee_activity_logs (tenant_id, staff_id, staff_name, action, details, occurred_at)
    VALUES (v_tenant, v_staff, COALESCE(v_staff_name, 'Staff'), 'open_shift',
            'فتح وردية برصيد افتتاحي ' || COALESCE(p_opening_balance, 0)::text, now());
  EXCEPTION WHEN OTHERS THEN
    -- Audit failure must never undo a shift that was really opened (the
    -- old client code's exact bug: a throwing audit insert made the open
    -- look "failed" although the row existed, so the cashier opened a
    -- second one).
    NULL;
  END;

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'open_shift', jsonb_build_object('shift_id', v_shift_id, 'already_open', false));

  RETURN jsonb_build_object('shift_id', v_shift_id, 'already_open', false, 'replayed', false);
END $function$;

CREATE OR REPLACE FUNCTION public.close_shift(p_operation_id uuid, p_shift_id uuid, p_actual_cash numeric, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

DROP FUNCTION IF EXISTS public.save_customer_measurements(uuid, jsonb);
DROP POLICY IF EXISTS customers_tenant_update ON public.customers;
CREATE POLICY customers_tenant_update ON public.customers FOR UPDATE TO public
  USING (app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_has_permission('customers.edit'::text) OR app_has_permission('orders.create'::text))))
  WITH CHECK (app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_has_permission('customers.edit'::text) OR app_has_permission('orders.create'::text))));
