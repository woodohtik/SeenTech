-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Fix-B
-- (whole-branch review finding C2).
--
-- Task 7 (20261211000000_select_policies_permission_based.sql) rewrote
-- supplier_transactions_tenant_select to gate on suppliers.manage via
-- app_has_permission() (Task 1), but never touched
-- supplier_transactions_tenant_write/_update/_delete -- those three
-- policies, created in 20261121000000_supplier_balance_role_guard.sql, are
-- still gated on the old hard-coded role list
-- (owner/admin/manager/accountant) and untouched by any migration since.
--
-- That gap is a real financial data integrity bug: Task 5
-- (20261209000000_supplier_rpcs_permission_check.sql) already gave
-- branch_manager/warehouse_manager real server-side access to
-- issue_supplier_payment/increment_supplier_balance via the same
-- suppliers.manage check (both roles have it true per Task 1's default
-- matrix, neither is in the old role-enum list). But addSupplierTransaction()
-- (src/services/supplierAccountsService.ts) follows up each of those RPC
-- calls with its own direct upsert into supplier_transactions -- which
-- these three unchanged policies still reject for those two roles. The
-- supplier's balance moves; the ledger entry recording it does not.
--
-- Fix (founder-approved): apply the identical suppliers.manage gate to all
-- three write policies, symmetric with Task 7's SELECT gate. Structure is
-- preserved exactly from the live definitions in
-- 20261121000000_supplier_balance_role_guard.sql -- only the role-enum
-- check inside the parens is swapped for app_has_permission('suppliers.manage').
-- Confirmed via grep that no migration between 20261121000000 and this one
-- touches any of these three policy names.

DROP POLICY IF EXISTS supplier_transactions_tenant_write ON public.supplier_transactions;
CREATE POLICY supplier_transactions_tenant_write ON public.supplier_transactions
    FOR INSERT TO authenticated
    WITH CHECK (
      app_is_super_admin()
      OR (tenant_id = app_current_tenant_id() AND public.app_has_permission('suppliers.manage'))
    );

DROP POLICY IF EXISTS supplier_transactions_tenant_update ON public.supplier_transactions;
CREATE POLICY supplier_transactions_tenant_update ON public.supplier_transactions
    FOR UPDATE TO authenticated
    USING (
      app_is_super_admin()
      OR (tenant_id = app_current_tenant_id() AND public.app_has_permission('suppliers.manage'))
    )
    WITH CHECK (
      app_is_super_admin()
      OR (tenant_id = app_current_tenant_id() AND public.app_has_permission('suppliers.manage'))
    );

DROP POLICY IF EXISTS supplier_transactions_tenant_delete ON public.supplier_transactions;
CREATE POLICY supplier_transactions_tenant_delete ON public.supplier_transactions
    FOR DELETE TO authenticated
    USING (
      app_is_super_admin()
      OR (tenant_id = app_current_tenant_id() AND public.app_has_permission('suppliers.manage'))
    );
