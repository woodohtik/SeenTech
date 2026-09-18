-- Closes a medium-priority finding from the 2026-09-17 full-team review
-- (database-reviewer): withdrawal_requests.tenant_id and
-- referrals.referrer_tenant_id had no index at all (verified live) --
-- the latter is read on every RLS check via the ref_own policy.
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_tenant ON public.withdrawal_requests (tenant_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_tenant ON public.referrals (referrer_tenant_id);
