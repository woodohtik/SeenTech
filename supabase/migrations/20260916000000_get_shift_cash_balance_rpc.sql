-- =============================================================================
--  get_shift_cash_balance: server-side cash-drawer balance for one shift
--  (seen-offline-coverage-and-performance-task.md Phase 4)
--
--  POS.tsx's fetchCashDrawerBalance and Sales.tsx's identical copy of it
--  both downloaded the full `shifts` row, every `shift_entries` row, and
--  EVERY `orders` row for the shift (select('*'), no limit) just to sum a
--  handful of numbers -- and both re-ran that full download on every single
--  realtime event on those three tables (a new order, a shift update, a
--  manual deposit/payout), so the download grows with every sale made
--  during the shift. Neither can simply gain a `.limit()` -- the audit for
--  this phase found the sums genuinely need every row to be correct, so a
--  row cap would silently produce a WRONG drawer balance, worse than the
--  performance problem. This RPC computes the same five numbers in
--  Postgres and returns just the result.
--
--  Formula matches the existing client-side calculation exactly (see
--  POS.tsx/Sales.tsx fetchCashDrawerBalance) -- not a redesign:
--    total = opening_balance
--          + SUM(orders.paid_amount WHERE status <> 'cancelled' AND payment_method = 'cash')
--          + SUM(shift_entries.amount WHERE entry_type = 'deposit')
--          - SUM(orders.paid_amount WHERE status = 'cancelled' AND payment_method = 'cash')
--          - SUM(shift_entries.amount WHERE entry_type = 'payout')
--
--  Deliberately narrower than a full Phase 4 sweep of every flagged
--  select('*') in this task: the wider audit found the other cases (low
--  stock scans, dashboard stats, unpaginated management lists) need either
--  a much larger RPC (many interdependent aggregates, growth-rate
--  comparisons across periods) or real pagination/search, both bigger,
--  separately-scoped follow-ups. This one RPC is a contained trial, same
--  as Phase 3's Suppliers.tsx-first approach.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_shift_cash_balance(p_shift_id UUID)
RETURNS TABLE (
  opening     NUMERIC,
  sales       NUMERIC,
  deposits    NUMERIC,
  withdrawals NUMERIC,
  returns     NUMERIC,
  total       NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(s.opening_balance, 0)::numeric AS opening,
    COALESCE(sales.amt, 0)::numeric AS sales,
    COALESCE(deposits.amt, 0)::numeric AS deposits,
    COALESCE(payouts.amt, 0)::numeric AS withdrawals,
    COALESCE(returns.amt, 0)::numeric AS returns,
    (
      COALESCE(s.opening_balance, 0)
      + COALESCE(sales.amt, 0)
      + COALESCE(deposits.amt, 0)
      - COALESCE(returns.amt, 0)
      - COALESCE(payouts.amt, 0)
    )::numeric AS total
  FROM public.shifts s
  LEFT JOIN LATERAL (
    SELECT SUM(o.paid_amount) AS amt FROM public.orders o
    WHERE o.shift_id = s.id AND o.status <> 'cancelled' AND o.payment_method = 'cash'
  ) sales ON true
  LEFT JOIN LATERAL (
    SELECT SUM(o.paid_amount) AS amt FROM public.orders o
    WHERE o.shift_id = s.id AND o.status = 'cancelled' AND o.payment_method = 'cash'
  ) returns ON true
  LEFT JOIN LATERAL (
    SELECT SUM(se.amount) AS amt FROM public.shift_entries se
    WHERE se.shift_id = s.id AND se.entry_type = 'deposit'
  ) deposits ON true
  LEFT JOIN LATERAL (
    SELECT SUM(se.amount) AS amt FROM public.shift_entries se
    WHERE se.shift_id = s.id AND se.entry_type = 'payout'
  ) payouts ON true
  -- Tenant scoping matches every other SECURITY DEFINER RPC in this repo
  -- (see create_pos_sale): trust app_current_tenant_id(), not a
  -- client-supplied tenant filter. A shift_id from another tenant simply
  -- returns zero rows rather than another tenant's numbers.
  WHERE s.id = p_shift_id
    AND s.tenant_id = public.app_current_tenant_id();
$$;

-- Same two-step lockdown as every other RPC here: REVOKE ALL FROM PUBLIC
-- does NOT touch Supabase's own default grants to anon/authenticated, so
-- both must be revoked explicitly before granting back to authenticated
-- only.
REVOKE ALL ON FUNCTION public.get_shift_cash_balance(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_shift_cash_balance(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shift_cash_balance(UUID) TO authenticated;
