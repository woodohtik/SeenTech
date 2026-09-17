-- Closes a real gap found by the 2026-09-17 full-team review
-- (compliance-reviewer): customers_tenant_delete (and the other three
-- customer policies) only checked tenant_id = app_current_tenant_id(),
-- with no role check at all -- verified live before this migration.
-- Any active staff member (including a cashier) could delete any
-- customer record in their tenant directly via the Postgrest API, even
-- though the app's own UI already treats delete as a separate, more
-- restricted permission from edit (src/components/Customers.tsx:156-158,
-- `customers.delete` vs `customers.create`/`customers.edit`) -- that
-- distinction was purely client-side and had no backing at the database
-- layer.
--
-- Scoped to DELETE only, not UPDATE: editing a customer's own record
-- (phone, measurements) is a normal, expected cashier/tailor action --
-- Customers.tsx already logs it as 'edit_measurements' -- so tightening
-- UPDATE too would break a legitimate workflow the review did not flag
-- as a problem. DELETE is the destructive, harder-to-justify-for-a-
-- cashier operation the review's concrete scenario was about.
--
-- Restricted to the shop-management roles (owner, admin, manager,
-- branch_manager) plus super_admin via app_is_super_admin(), matching
-- the roles that already exist on user_role. This does not depend on
-- the roles_permissions/custom-role JSONB permission system (that table
-- has its own separate schema-drift issue, tracked elsewhere) -- it is a
-- coarse, dependable floor enforced at the database layer regardless of
-- whatever a tenant has customized in their custom roles.
DROP POLICY IF EXISTS customers_tenant_delete ON customers;
CREATE POLICY customers_tenant_delete ON customers
    FOR DELETE USING (
        app_is_super_admin()
        OR (
            tenant_id = app_current_tenant_id()
            AND EXISTS (
                SELECT 1 FROM staff s
                WHERE s.uid = app_current_uid()
                  AND s.status = 'active'
                  AND s.tenant_id = customers.tenant_id
                  AND s.role IN ('owner', 'admin', 'manager', 'branch_manager')
            )
        )
    );
