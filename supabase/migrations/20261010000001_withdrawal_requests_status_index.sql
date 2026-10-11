-- withdrawal_requests has an index on tenant_id (20260919020000) but none on
-- status, despite listPendingWithdrawals() (src/services/referralService.ts)
-- scanning across every tenant filtered + sorted by (status, requested_at).
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status_requested
  ON public.withdrawal_requests (status, requested_at);
