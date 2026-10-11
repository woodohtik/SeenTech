-- seen-zatca-service-process.md -- tenants.address/vat_number/commercial_register
-- already existed, but city/postal_code never did, despite both being required
-- by the ZATCA invoice XML (ZatcaParty.city/postalCode in zatcaInvoiceXml.ts)
-- and by the CSR subject built during onboarding.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS postal_code TEXT;

-- Holds a CSR + its private key between "generate CSR" (shown to the
-- merchant to paste into their own Fatoora Portal account) and "submit OTP"
-- (which needs the SAME key pair the CSR was built with, since ZATCA's
-- issued certificate is bound to that CSR's embedded public key) -- these
-- are two separate requests, potentially minutes/hours apart while the
-- merchant goes to zatca.gov.sa for their OTP. Not zatca_credentials: that
-- table requires a real issued certificate (NOT NULL), and this holds
-- neither a certificate nor a real CSID yet. Deleted once promoted into
-- zatca_credentials (compliance step) or once the production step completes.
CREATE TABLE IF NOT EXISTS public.zatca_pending_csr (
  tenant_id              UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  private_key_encrypted  TEXT NOT NULL, -- AES-256-GCM via src/server/zatcaCrypto.ts, same as zatca_credentials
  csr_base64             TEXT NOT NULL,
  egs_serial_number      TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.zatca_pending_csr ENABLE ROW LEVEL SECURITY;
-- No policies, deliberately -- same reasoning as zatca_credentials: holds a
-- private key that must never reach the browser, so only server.ts using
-- the service-role key (which bypasses RLS) may touch this table.
