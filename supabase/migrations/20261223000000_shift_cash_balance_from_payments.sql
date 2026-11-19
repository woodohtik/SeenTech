-- The live till figure (the POS header and the close-shift preview) and the
-- figure close_shift actually settles on were computed two different ways.
--
-- close_shift has taken its cash from `payments` since 20261128000000
-- ("single source of truth"): every payment attributed to the shift, whether
-- a POS sale, a tailoring deposit, or a later settlement. This function was
-- left reading orders.paid_amount for orders whose shift_id is the shift.
-- A tailoring order never carries a shift_id, so its deposit was missing
-- here: the preview showed "expected 0", asked the cashier to explain a
-- surplus, and close_shift then reconciled to the real figure anyway.
--
-- Same signature, same columns; the amounts now follow close_shift exactly:
--   sales       = cash payments on the shift
--   returns     = cash refunds from sales_returns on the shift
--   deposits / withdrawals = shift_entries, unchanged
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
    ROUND(
      COALESCE(s.opening_balance, 0)
      + COALESCE(sales.amt, 0)
      + COALESCE(deposits.amt, 0)
      - COALESCE(returns.amt, 0)
      - COALESCE(payouts.amt, 0)
    , 2)::numeric AS total
  FROM public.shifts s
  LEFT JOIN LATERAL (
    SELECT SUM(p.amount) AS amt FROM public.payments p
    WHERE p.shift_id = s.id AND p.tenant_id = s.tenant_id AND p.method = 'cash'
  ) sales ON true
  LEFT JOIN LATERAL (
    SELECT SUM(r.refunded_amount) AS amt FROM public.sales_returns r
    WHERE r.shift_id = s.id AND r.tenant_id = s.tenant_id AND r.refund_method = 'cash'
  ) returns ON true
  LEFT JOIN LATERAL (
    SELECT SUM(se.amount) AS amt FROM public.shift_entries se
    WHERE se.shift_id = s.id AND se.entry_type = 'deposit'
  ) deposits ON true
  LEFT JOIN LATERAL (
    SELECT SUM(se.amount) AS amt FROM public.shift_entries se
    WHERE se.shift_id = s.id AND se.entry_type = 'payout'
  ) payouts ON true
  WHERE s.id = p_shift_id
    AND s.tenant_id = public.app_current_tenant_id();
$$;

REVOKE ALL ON FUNCTION public.get_shift_cash_balance(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_shift_cash_balance(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shift_cash_balance(UUID) TO authenticated;
