-- Security audit 2026-10-25, fingerprint
-- support-sessions-actor-not-bound-to-auth-uid (medium): support_sessions
-- is the sole audit trail for super-admin impersonation of tenant accounts.
-- Its only RLS policy (support_sessions_super_admin_only, FOR ALL) checked
-- only app_is_super_admin() -- never that the row's own saas_user_id column
-- equals the caller's identity -- so any super_admin could INSERT a row
-- attributing an impersonation to a DIFFERENT super_admin, or UPDATE/DELETE
-- any existing row (including closing another admin's still-open session,
-- or erasing the only record of their own). src/services/impersonationService.ts
-- writes this table through the normal browser client with a plain
-- caller-supplied actor.id, never a server-derived identity.
--
-- Fix: split the single FOR ALL policy into per-command policies. SELECT
-- stays open to any super_admin (platform-wide audit visibility is
-- intended). INSERT now requires saas_user_id = app_current_uid(), so a
-- row can only ever be attributed to its real author. There is no
-- UPDATE/DELETE policy for 'authenticated' at all any more -- audit rows
-- become append-only from the client; the one legitimate mutation (closing
-- your own open session) moves to a SECURITY DEFINER RPC that verifies
-- ownership server-side before updating.
--
-- Scoped to support_sessions only, not its sibling support_access_requests:
-- that table has a different, not-yet-fully-traced consumer model (a
-- tenant-owner consent flow via src/components/SupportConsentModal.tsx
-- appears to also read/write it, not just super_admins), so applying the
-- same saas_user_id-must-equal-caller restriction there risks breaking a
-- legitimate tenant-side approval/rejection this migration did not verify.
-- Left as a flagged follow-up rather than guessed at here.

DROP POLICY IF EXISTS support_sessions_super_admin_only ON public.support_sessions;

CREATE POLICY support_sessions_select_super_admin ON public.support_sessions
    FOR SELECT TO authenticated
    USING (app_is_super_admin());

CREATE POLICY support_sessions_insert_self ON public.support_sessions
    FOR INSERT TO authenticated
    WITH CHECK (app_is_super_admin() AND saas_user_id = app_current_uid()::uuid);

-- No UPDATE/DELETE policy for 'authenticated' -- these rows are now
-- append-only from the client. service_role (used by any future ops/
-- retention tooling) retains its implicit RLS bypass.

CREATE OR REPLACE FUNCTION public.end_impersonation_session(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid TEXT := app_current_uid();
    v_row RECORD;
BEGIN
    IF v_uid IS NULL OR NOT app_is_super_admin() THEN
        RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
    END IF;

    SELECT id, started_at INTO v_row
    FROM public.support_sessions
    WHERE tenant_id = p_tenant_id
      AND saas_user_id = v_uid::uuid
      AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1;

    IF v_row.id IS NOT NULL THEN
        UPDATE public.support_sessions
        SET ended_at = NOW(),
            duration_minutes = CEIL(EXTRACT(EPOCH FROM (NOW() - v_row.started_at)) / 60)
        WHERE id = v_row.id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.end_impersonation_session(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_impersonation_session(UUID) TO authenticated;
