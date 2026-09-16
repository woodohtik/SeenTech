-- Completes tracking the untracked hand-patches from
-- scripts/legacy-oneoff/fix-rls.sql that 20260824090000_tenants_onboarding_insert_policy.sql
-- and 20260917040000_track_app_current_tenant_id.sql did not yet cover.
--
-- Verified live on staging on 2026-09-17 (via a temporary read-only
-- migration, pg_get_functiondef + pg_policies -- never applied for real)
-- before writing this, rather than trusted from the file blindly:
--   - app_is_super_admin() matches fix-rls.sql exactly.
--   - users_self_read/write, users_super_admin_write, tailor_requests_self/
--     create/update match fix-rls.sql exactly.
--   - staff_onboarding_insert does NOT match fix-rls.sql -- the live policy
--     is stricter (it additionally blocks a self-onboarding INSERT from
--     setting role to 'owner' or 'admin', preventing privilege escalation
--     during staff self-signup). That live body is used below, not the
--     stale one in fix-rls.sql, since it is a further undocumented patch
--     on top of that file.
--
-- Once this applies, scripts/legacy-oneoff/fix-rls.sql has no remaining
-- untracked content and should be treated as historical reference only --
-- do not run it by hand again.
CREATE OR REPLACE FUNCTION app_is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    is_admin BOOLEAN;
    cur_uid TEXT;
BEGIN
    cur_uid := app_current_uid();
    IF cur_uid IS NULL THEN RETURN FALSE; END IF;
    SELECT TRUE INTO is_admin FROM saas_users WHERE uid = cur_uid AND role = 'super_admin' AND is_active = true;
    RETURN COALESCE(is_admin, FALSE);
END;
$$;

DROP POLICY IF EXISTS users_self_read ON users;
CREATE POLICY users_self_read ON users
    FOR SELECT USING (app_is_super_admin() OR id = app_current_uid());

DROP POLICY IF EXISTS users_self_write ON users;
CREATE POLICY users_self_write ON users
    FOR UPDATE USING (app_is_super_admin() OR id = app_current_uid())
    WITH CHECK (app_is_super_admin() OR id = app_current_uid());

DROP POLICY IF EXISTS "users_super_admin_write" ON users;
CREATE POLICY "users_super_admin_write" ON users
    FOR INSERT WITH CHECK (id = app_current_uid() OR app_is_super_admin());

DROP POLICY IF EXISTS tailor_requests_self ON tailor_requests;
CREATE POLICY tailor_requests_self ON tailor_requests
    FOR SELECT USING (
        app_is_super_admin() OR uid = app_current_uid()
    );

DROP POLICY IF EXISTS tailor_requests_create ON tailor_requests;
CREATE POLICY tailor_requests_create ON tailor_requests
    FOR INSERT WITH CHECK (uid = app_current_uid());

DROP POLICY IF EXISTS tailor_requests_update ON tailor_requests;
CREATE POLICY tailor_requests_update ON tailor_requests
    FOR UPDATE USING (
        app_is_super_admin() OR uid = app_current_uid()
    )
    WITH CHECK (
        app_is_super_admin() OR uid = app_current_uid()
    );

-- Live body (stricter than fix-rls.sql -- see header note): blocks a
-- self-onboarding staff INSERT from setting its own role to owner/admin.
DROP POLICY IF EXISTS "staff_onboarding_insert" ON staff;
CREATE POLICY "staff_onboarding_insert" ON staff
    FOR INSERT WITH CHECK (
        app_is_super_admin()
        OR (uid = app_current_uid() AND role <> ALL (ARRAY['owner'::user_role, 'admin'::user_role]))
    );
