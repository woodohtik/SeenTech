-- =============================================================================
--  seen-ai-assistant-zatca-cr-task.md, ZATCA #2: zatca_credentials had no
--  expiry field at all and nothing ever checked for an approaching ZATCA
--  CSID expiry -- a tenant's production certificate silently lapsing would
--  only ever be discovered the hard way, the next time a real sale's
--  clearance/reporting call failed. This adds the field and a tracking
--  column so the new /api/cron/zatca-cert-expiry-check route (server.ts)
--  can alert exactly once per certificate, not once per day until renewal.
-- =============================================================================

ALTER TABLE public.zatca_credentials
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expiry_alert_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_zatca_credentials_expires_at
  ON public.zatca_credentials (expires_at)
  WHERE expires_at IS NOT NULL;
