-- seen-cto-code-review-2026-11-13.md, سبرنت 1، البند 3 (CASH-07..CASH-14 /
-- CASH-10 / C7). Read cto-review-2026-11-13/08-cash-offline-pwa.md's full
-- CASH-07 through CASH-14 entries first.
--
-- ShiftClosingModal.tsx computed the entire Z-report in the browser from an
-- unbounded, uncapped `orders` read (PostgREST caps at 1000 rows -- a busy
-- shift silently truncated), then wrote expected_cash/discrepancy/totals
-- straight into `shifts` with no server recomputation at all; the generic
-- RLS UPDATE policy let any staff member in the tenant rewrite any shift's
-- figures (open or already closed), and "who may close this shift" was a
-- disabled-button check only. Refunds were attributed to the SALE's shift,
-- not the till that actually paid the cash back out; 'partial'/
-- 'cash_on_delivery' payments (real cash in the drawer) were excluded from
-- "cash" entirely. Two open shifts per staff were possible (no unique
-- index), so three different screens could each believe a different shift
-- was "the" open one.
--
-- Fix:
-- - close_shift(p_shift_id, p_operation_id, p_actual_cash, p_reason)
--   SECURITY DEFINER RPC: locks the shift row, computes every total from
--   SQL aggregates over the real tables (no row cap, no client math),
--   requires the caller to be the shift's own staff or owner/admin/
--   manager, records the real closing actor, and makes the shift
--   immutable afterward via trigger + revoked direct UPDATE on the
--   money/status columns.
-- - Refunds are read from sales_returns.shift_id (added in the previous
--   migration specifically so process_sales_return could record which
--   till actually paid the refund out) instead of guessing from
--   orders.status='cancelled' -- which is also now correct given that
--   migration's own change: returns no longer auto-cancel the order, so
--   the old "cancelled cash orders" signal would silently stop counting
--   refunds as cash left the drawer at all.
-- - The cash-drawer reconciliation itself still counts only
--   payment_method = 'cash' (matching ShiftTotals.card/bank_transfer/
--   credit's own strict 1:1 enum mapping, and what get_shift_cash_balance
--   and the old client code both already did). A 'partial' order's
--   paid_amount is NOT assumed to be cash -- there is no payments ledger
--   recording how much of a split payment was cash vs. card, so counting
--   all of it as cash risks a WRONG expected-cash figure in the one place
--   this migration exists to make correct. Splitting 'partial'/
--   'cash_on_delivery' into their real cash/non-cash portions needs the
--   payments-ledger rebuild (sprint-1 item 4), not a guess here.
-- - The full ShiftTotals shape ZReport.tsx/the Excel export already
--   render (card/bank_transfer/credit split, gross sales, order count,
--   items sold, per-product breakdown, total returns regardless of
--   method) is now computed the same way -- real SQL aggregates, not a
--   subset -- so closing a shift through this RPC does not quietly blank
--   out sections of the printed Z-report that the old client code filled.
-- - open_shift(p_operation_id, p_opening_balance, p_branch_id) RPC +
--   a unique partial index (one open shift per staff) -- close_shift's
--   whole premise ("the shift") depends on there only ever being one.
--
-- NOT in scope here (separate, larger items):
-- - Rejecting/queuing a sale that arrives for an already-closing/closed
--   shift (CASH-09's race) -- needs create_pos_sale to also lock/check the
--   shift status, a further follow-up.
-- - The daily (multi-shift) Z-report's UTC-window bug (CASH-15) and the
--   Z-report's reproducibility gaps (CASH-16) -- Reports.tsx/ZReport.tsx,
--   not touched here.
-- - issue_supplier_payment (CASH-18) -- a separate task-file item.

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES public.staff(id) ON DELETE SET NULL;

-- CASH-10: one open shift per staff member at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_open_shift_per_staff
  ON public.shifts (tenant_id, staff_id)
  WHERE status = 'open';

CREATE OR REPLACE FUNCTION public.open_shift(
  p_operation_id UUID,
  p_opening_balance NUMERIC,
  p_branch_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;

REVOKE EXECUTE ON FUNCTION public.open_shift(UUID, NUMERIC, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.open_shift(UUID, NUMERIC, UUID) TO authenticated;

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

  IF v_staff IS DISTINCT FROM v_shift_staff AND (v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager')) THEN
    RAISE EXCEPTION 'لا تملك صلاحية إغلاق وردية موظف آخر' USING ERRCODE = '42501';
  END IF;

  -- Every total computed from a real SQL aggregate over the actual
  -- tables -- no row cap, no client-side sum, no trusting whatever the
  -- browser already had loaded.
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

  -- Refunds attributed to the till that actually paid the cash back out
  -- (sales_returns.shift_id, set by process_sales_return), not the
  -- original sale's shift -- fixes CASH-08's "refund hits the wrong
  -- drawer" and stays correct now that returns no longer cancel the
  -- order (so a cancelled-orders signal would miss them entirely).
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
    -- Matches CASH-14's fix note: an audit-log failure must never make an
    -- already-successful close look like it failed.
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

-- CASH-11: the generic tenant-wide UPDATE policy let any staff member
-- rewrite any shift's money/status columns (open or already closed) --
-- only close_shift/open_shift (SECURITY DEFINER, already revoked from
-- anon/PUBLIC above) may change them now. A plain client PATCH to shifts
-- can still update genuinely harmless fields (nothing currently needs
-- direct client writes to shifts at all, so this trigger blocks the
-- dangerous columns specifically rather than removing write access
-- wholesale, in case some other legitimate narrow update exists today).
-- NOT SECURITY DEFINER: the whole point is to see the real caller's role.
-- A SECURITY DEFINER trigger runs as this function's owner, which makes
-- current_user always the owner (e.g. postgres) regardless of who issued
-- the UPDATE -- that would make the "postgres/service_role" bypass below
-- match every caller and defeat the guard entirely.
CREATE OR REPLACE FUNCTION public.shifts_protect_financial_columns()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.expected_cash IS DISTINCT FROM OLD.expected_cash
     OR NEW.actual_cash IS DISTINCT FROM OLD.actual_cash
     OR NEW.closing_balance IS DISTINCT FROM OLD.closing_balance
     OR NEW.discrepancy IS DISTINCT FROM OLD.discrepancy
     OR NEW.totals IS DISTINCT FROM OLD.totals
     OR NEW.closed_by IS DISTINCT FROM OLD.closed_by
     OR NEW.end_time IS DISTINCT FROM OLD.end_time
  THEN
    RAISE EXCEPTION 'لا يمكن تعديل أرقام الوردية مباشرة -- أغلقها عبر close_shift' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shifts_protect_financial_columns ON public.shifts;
CREATE TRIGGER trg_shifts_protect_financial_columns
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.shifts_protect_financial_columns();
