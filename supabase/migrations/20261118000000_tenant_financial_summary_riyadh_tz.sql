-- Sprint 2 reports engine, item 1 (seen-cto-sprint2-reports-engine-task.md):
-- "دالة خادم واحدة لصافي الربح/الإيراد بتوقيت الرياض". Confirmed by reading
-- the code, not guessed: Reports.tsx fetches orders/shift_entries/etc
-- entirely unbounded and aggregates revenue/tax/operating-expenses in the
-- browser, with date-range filtering done as plain string comparison on
-- whatever ISO timestamp string Postgres returned -- no Riyadh conversion
-- anywhere (an order at 23:30 Riyadh time on day N can already be day N+1
-- in UTC, so "today" boundaries silently drift). Reports.tsx itself had
-- TWO different net-profit formulas on the same screen. This function is
-- the one server-side source for revenue/tax/operating-expenses, with
-- Riyadh-correct date boundaries -- COGS stays client-side (Reports.tsx's
-- existing weighted-average purchase-cost estimate, now reading real
-- order items after the previous commit's fix, is the only real cost
-- data this system has; duplicating that estimate in SQL would be a
-- second, divergent implementation of the same guess).
-- src/services/financialSummaryService.ts is the ONE place that combines
-- this RPC's numbers with the client-side COGS estimate into a final net
-- profit figure -- any screen showing net profit should call it instead
-- of computing its own.
CREATE OR REPLACE FUNCTION public.get_tenant_financial_summary(
  p_tenant_id UUID,
  p_date_from DATE,
  p_date_to   DATE,
  p_branch_id UUID DEFAULT NULL,
  p_staff_id  UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  RETURN jsonb_build_object(
    'revenue', v_revenue,
    'tax', v_tax,
    'order_count', v_order_count,
    'operating_expenses', v_expenses,
    'date_from', p_date_from,
    'date_to', p_date_to
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.get_tenant_financial_summary(UUID, DATE, DATE, UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_tenant_financial_summary(UUID, DATE, DATE, UUID, UUID) TO authenticated;

-- Same Riyadh-boundary fix for the existing SaaS (super-admin) revenue
-- RPC: date_trunc on a timestamptz truncates using the DB session's
-- TimeZone setting, which is UTC unless changed -- "this month"/"this
-- day" boundaries were off by Riyadh's +03:00 offset here too.
CREATE OR REPLACE FUNCTION get_saas_revenue_report()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_total_revenue numeric;
  v_monthly jsonb;
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: super admin only';
  END IF;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_total_revenue FROM orders;

  SELECT COALESCE(jsonb_agg(m ORDER BY m.month_start), '[]'::jsonb) INTO v_monthly
  FROM (
    SELECT date_trunc('month', order_date AT TIME ZONE 'Asia/Riyadh') AS month_start,
           SUM(total_amount) AS revenue
    FROM orders
    WHERE order_date >= (date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') - interval '11 months') AT TIME ZONE 'Asia/Riyadh'
    GROUP BY date_trunc('month', order_date AT TIME ZONE 'Asia/Riyadh')
  ) m;

  RETURN jsonb_build_object('total_revenue', v_total_revenue, 'monthly', v_monthly);
END; $$;

REVOKE EXECUTE ON FUNCTION get_saas_revenue_report() FROM anon;
