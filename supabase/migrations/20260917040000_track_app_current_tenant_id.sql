-- Closes a real schema-drift gap found by the 2026-09-17 full-team review
-- (مراجعة-الفريق-التقني-الكامل-2026-09-17.md, critical finding #1).
--
-- app_current_tenant_id() is the function nearly every RLS policy in the
-- project depends on (directly, or via app_is_super_admin()) to scope a
-- request to its tenant. Its ONLY tracked definition lives in
-- supabase/legacy-setup/wdooh-database-schema.sql -- a manually-run base
-- schema file, not a numbered migration -- and that copy reads
-- current_setting('app.current_tenant_id', true), a session variable
-- nothing in this codebase ever sets. On staging today the function was
-- hand-patched (via scripts/legacy-oneoff/fix-rls.sql, applied directly
-- through the Supabase SQL editor, never committed as a migration) to
-- derive the tenant from the verified JWT instead. Verified live on
-- staging on 2026-09-17 via a temporary read-only migration
-- (CREATE OR REPLACE never ran; the transaction raised and rolled back)
-- that dumped pg_get_functiondef() for this function -- the body below is
-- an exact copy of what is running there right now.
--
-- Without this migration, rebuilding any environment from
-- legacy-setup + supabase/migrations alone silently reinstates the broken
-- current_setting()-based version, which always returns NULL and blocks
-- every tenant-scoped table -- or, if that session variable were ever
-- wired up from a client-controlled source "for performance", would
-- reopen exactly the cross-tenant data leak this function's own comment
-- already describes once being fixed.
CREATE OR REPLACE FUNCTION public.app_current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    t_id UUID;
    cur_uid TEXT;
BEGIN
    -- SECURITY: The tenant ID is derived ONLY from the verified JWT
    -- (via app_current_uid()), never from a client-supplied header.
    -- A previous version trusted an `x-tenant-id` request header "for
    -- performance", which let any authenticated user set that header (via
    -- localStorage in the web client) and read/write ANY other tenant's data --
    -- a full cross-tenant isolation breach. That header shortcut is removed.

    cur_uid := app_current_uid();
    IF cur_uid IS NULL THEN RETURN NULL; END IF;

    -- 1. Check if user is staff (Owner is often also staff)
    -- This query bypasses RLS because it's in a SECURITY DEFINER function
    SELECT tenant_id INTO t_id FROM staff WHERE uid = cur_uid AND status = 'active' LIMIT 1;
    IF t_id IS NOT NULL THEN
        RETURN t_id;
    END IF;

    -- 2. Check if user is owner directly from tenants table
    SELECT id INTO t_id FROM tenants WHERE owner_uid = cur_uid LIMIT 1;
    RETURN t_id;
END;
$function$;
