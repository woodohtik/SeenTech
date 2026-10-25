-- Security audit 2026-10-25, fingerprint print-relay.raw-probe.no-tenant-scoping:
-- /api/print/raw and /api/print/probe (the no-relay-agent, server-on-LAN
-- direct-TCP fallback in src/server/printRelay.ts) only ever checked
-- "authenticated + private IP + allowed port" -- any tenant's staff member
-- could target any other tenant's printer host once they knew or guessed its
-- LAN IP, since nothing recorded which tenant a given host:port belongs to.
--
-- First-use pinning: the first tenant to successfully use a given host:port
-- through these routes claims it; any other tenant later targeting the same
-- host:port is rejected. No existing data to backfill (the routes never
-- recorded a host anywhere), so this starts empty and fills in as tenants
-- actually use the fallback.
CREATE TABLE IF NOT EXISTS tenant_print_hosts (
  host       TEXT NOT NULL,
  port       INTEGER NOT NULL,
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (host, port)
);

ALTER TABLE tenant_print_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_print_hosts FORCE ROW LEVEL SECURITY;

-- No policies for `authenticated`/`anon` on purpose: printRelay.ts only ever
-- talks to this table through supabaseAdmin (service role), exactly like
-- print_stations/print_jobs above it in the same file.

REVOKE ALL ON tenant_print_hosts FROM authenticated, anon;
