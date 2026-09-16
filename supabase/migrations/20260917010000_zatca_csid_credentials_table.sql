-- =============================================================================
--  ZATCA Phase 2 readiness, Phase 4: per-tenant CSID credential storage
--  (seen-zatca-readiness-task.md)
--
--  A ZATCA Cryptographic Stamp Identifier (CSID) is issued per taxpayer in
--  two stages: a Compliance CSID (sandbox testing, obtained via CSR + OTP
--  during onboarding) and later a Production CSID (live). Each comes with
--  a private key (used to sign invoices -- must never leave the server or
--  be stored in plaintext) and a "secret" ZATCA issues alongside the
--  certificate (used for HTTP Basic Auth against ZATCA's own APIs -- also
--  a secret). The certificate itself is not secret, but is tenant-specific
--  and stored alongside its key pair for convenience.
--
--  This table only exists once a tenant has actually completed Phase 1 --
--  the real business registration with ZATCA (OTP, CSR, sandbox compliance
--  testing) that only the tenant/business owner can do, using their own
--  government-portal access. No row here can be produced by this codebase
--  on its own.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.zatca_credentials (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  csid_type              TEXT NOT NULL CHECK (csid_type IN ('compliance', 'production')),
  certificate            TEXT NOT NULL, -- X.509 cert (PEM) from ZATCA -- not secret, but tenant-specific
  private_key_encrypted  TEXT NOT NULL, -- AES-256-GCM via src/server/zatcaCrypto.ts, same pattern as assistantCrypto.ts -- never plaintext, never sent to the browser
  secret_encrypted       TEXT NOT NULL, -- ZATCA's own API secret (Basic Auth), same encryption
  request_id             TEXT,          -- ZATCA's compliance/production request id, for renewals and support
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, csid_type)
);

CREATE INDEX IF NOT EXISTS idx_zatca_credentials_tenant ON public.zatca_credentials (tenant_id);

ALTER TABLE public.zatca_credentials ENABLE ROW LEVEL SECURITY;
-- No policies at all, deliberately -- same reasoning as
-- zatca_invoice_chain_state in the previous migration, but even more
-- important here: this table's whole purpose is to hold a private key that
-- must never reach the browser. It must only ever be read or written by
-- server.ts using the service-role key (which bypasses RLS entirely), never
-- by the anon/authenticated Supabase client. RLS enabled with zero policies
-- means exactly that: no client role can touch this table at all.

CREATE TRIGGER trg_zatca_credentials_updated_at
  BEFORE UPDATE ON public.zatca_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
