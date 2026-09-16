-- =============================================================================
--  WhatsApp auto-send Phase 2: per-tenant session storage
--  (seen-whatsapp-auto-send-task.md)
--
--  One row per tenant, holding that tenant's own WhatsApp Web session
--  (Evolution API/Baileys auth state) -- strict isolation is the whole point
--  here: a leaked or crossed session would mean sending messages from
--  another business's WhatsApp number without their knowledge. The session
--  state itself is encrypted the same way assistant_provider_credentials'
--  api_key_encrypted already is (src/server/assistantCrypto.ts, AES-256
--  -GCM) -- reusing that module, not new crypto, per the task's own
--  instruction. RLS enabled with zero policies, same reasoning as
--  zatca_credentials: this must only ever be reached by server.ts's
--  service-role client, never the browser.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tenant_whatsapp_sessions (
  tenant_id             UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_state_encrypted TEXT,       -- Evolution API/Baileys auth creds JSON, AES-256-GCM via assistantCrypto.ts -- NULL until first successful QR link
  phone_number          TEXT,         -- the WhatsApp number actually linked, once known (E.164)
  status                TEXT NOT NULL DEFAULT 'pending_qr'
                          CHECK (status IN ('pending_qr', 'connected', 'disconnected', 'banned')),
  last_connected_at     TIMESTAMPTZ,
  last_disconnected_at  TIMESTAMPTZ,
  connected_by_staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  -- Phase 6 (thundering-herd mitigation): a reconnect worker checks this
  -- before retrying a disconnected session, so a mass outage doesn't
  -- reconnect every tenant's session in the same instant.
  next_reconnect_at     TIMESTAMPTZ,
  reconnect_attempts    INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_whatsapp_sessions_status ON public.tenant_whatsapp_sessions (status);

ALTER TABLE public.tenant_whatsapp_sessions ENABLE ROW LEVEL SECURITY;
-- No policies at all, deliberately -- only server.ts's service-role client
-- may read or write this table (it holds a working WhatsApp session,
-- functionally equivalent to a password for that number). The anon/
-- authenticated Supabase client gets zero access.

CREATE TRIGGER trg_tenant_whatsapp_sessions_updated_at
  BEFORE UPDATE ON public.tenant_whatsapp_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
