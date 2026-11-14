-- seen-cto-sprint0-critical-fixes-task.md item 3 (DB2-01, STF-04).

-- -----------------------------------------------------------------------
-- 1) staff_onboarding_insert had NO tenant_id condition whatsoever: any
--    authenticated user could INSERT a role='cashier' row for themselves
--    into ANY tenant_id of their choosing (not just their own), instantly
--    gaining staff access to a tenant they have no relationship with --
--    app_current_tenant_id() would then resolve to that victim tenant for
--    every subsequent RLS check across the whole app.
--
--    Read ForcePinSetup.tsx (its sole legitimate caller) in full: the
--    self-registering-cashier fallback (after bootstrap_tenant_owner RPC
--    fails because the tenant already has staff) inserts for whatever
--    tenantId prop it was given, with NO verification that the caller is
--    actually related to that tenant at all -- confirming the gap is
--    real, not just theoretical. Scoping the policy to "tenant owned by
--    the caller" (rather than converting to a SECURITY DEFINER RPC) is
--    sufficient here and keeps the existing client call working for its
--    one real legitimate case.
-- -----------------------------------------------------------------------

DROP POLICY IF EXISTS "staff_onboarding_insert" ON staff;
CREATE POLICY "staff_onboarding_insert" ON staff
    FOR INSERT WITH CHECK (
        app_is_super_admin()
        OR (
            uid = app_current_uid()
            AND role = 'cashier'::user_role
            AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = tenant_id AND t.owner_uid = app_current_uid())
        )
    );

-- -----------------------------------------------------------------------
-- 2) Public listing of the uploads bucket (item-0 finding) -- NOT fixed
--    in this migration. See the task file's note for item 3: closing it
--    requires revoking EXECUTE on storage.list_objects_with_delimiter,
--    which is owned by Supabase's own supabase_storage_admin role. The
--    connecting migration role cannot revoke that grant, and assuming
--    supabase_storage_admin via SET ROLE to do it anyway was correctly
--    blocked as unauthorized privilege escalation into platform-internal
--    infrastructure -- not attempted further. Left to the Dashboard/
--    Supabase support, or a deliberate private-bucket migration, per the
--    task file's note.
-- -----------------------------------------------------------------------
