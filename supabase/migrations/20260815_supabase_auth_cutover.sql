-- Stage 2: Firebase Auth -> Supabase Auth cutover.
--
-- Every identity-sensitive RLS policy in wdooh-database-schema.sql, fix-rls.sql,
-- MARKETPLACE_foundation.sql and INVENTORY_FIX.sql calls through app_current_uid()
-- (directly or via app_is_super_admin()/app_current_tenant_id(), which are built on
-- top of it) — so redefining this one function body is sufficient to move every
-- policy over to native Supabase Auth, with no CREATE POLICY changes needed.
--
-- The COALESCE fallback to the legacy Firebase-JWT claim is a TRANSITION-WINDOW
-- SAFETY NET ONLY (see MIGRATION_STAGE1.md / the Stage 2 rollout plan) for accounts
-- that haven't been migrated to a Supabase Auth user yet, or requests still bearing
-- an old Firebase ID token during the cutover window. It must be removed in a
-- fast-follow migration once that window closes (see 20260815_drop_legacy_uid_fallback.sql,
-- added once the transition is confirmed stable) — a long-lived dual-JWT-trust
-- scheme is a needless permanent attack surface.
CREATE OR REPLACE FUNCTION app_current_uid()
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
    SELECT COALESCE(
        auth.uid()::text,
        current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
    )
$$;
