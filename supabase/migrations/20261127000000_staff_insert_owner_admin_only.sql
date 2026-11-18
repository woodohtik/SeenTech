-- seen-status-fix-regressions-task.md item 4 (🔴 account takeover, second
-- pass). Two gaps, closed together because the account-takeover exploit
-- chains them:
--
-- 1. `staff` INSERT was still on the generic tenant_tables_loop policy
--    (tenant_id = app_current_tenant_id() only, no role check at all --
--    confirmed via 20240601000000's loop, never narrowed since). ANY
--    staff member (a cashier included) could insert a staff row for ANY
--    email, with ANY role, into their own tenant. This is also the hole
--    behind the now-removed password-reset path in
--    staffAccountService.ts: an attacker-owner could insert a
--    role='cashier' row for the VICTIM's email first, which made a
--    same-tenant-staff-row check pass for an email that was never
--    actually theirs.
-- 2. `users.created_by_tenant_id`: new column recording which tenant's
--    create-account call actually provisioned a given Auth account (set
--    server-side in staffAccountService.ts, never client-controlled) --
--    the anchor a future tenant-scoped password-reset flow needs to
--    verify "this account was created by MY shop", instead of the
--    removed check ("a staff row for this email happens to exist in my
--    shop", which the caller could manufacture themselves).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS created_by_tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "staff_tenant_insert" ON public.staff;
CREATE POLICY "staff_tenant_insert" ON public.staff
    FOR INSERT WITH CHECK (
        app_is_super_admin()
        OR (
            tenant_id = app_current_tenant_id()
            AND app_current_role() IN ('owner', 'admin')
            -- an admin may not insert an owner-level staff row (privilege
            -- escalation within the tenant); only an owner can.
            AND (role <> 'owner'::user_role OR app_current_role() = 'owner')
        )
    );
