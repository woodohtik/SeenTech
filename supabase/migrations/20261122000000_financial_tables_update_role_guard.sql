-- =============================================================================
-- seen-cto-sprint4-permissions-task.md item 2 (CTO review section 6/3,
-- confirmed by a dedicated security audit): 20261114000001 narrowed DELETE
-- on orders/order_items/payments/shifts/shift_entries/sales_returns to
-- owner/admin/manager, but explicitly left UPDATE untouched (its own
-- comment, line 19: "does NOT touch the existing UPDATE/INSERT RLS
-- policies") -- every one of these six tables was still on the generic
-- tenant_tables_loop UPDATE policy (tenant match only), so any staff
-- member -- a cashier, never shown the staff/supplier/reports screens at
-- all -- could call supabase.from('payments').update({amount: 999999})
-- or supabase.from('orders').update({total_amount: 0, paid_amount: 0})
-- directly from the browser console, bypassing create_pos_sale/
-- record_order_payment/close_shift entirely.
--
-- Before narrowing, every direct client-side .update() call on these six
-- tables was grepped across src/ (not assumed):
--   - order_items, payments, shifts, shift_entries, sales_returns: ZERO
--     direct .update() call sites anywhere. Every write to these five
--     goes through a SECURITY DEFINER RPC (create_pos_sale,
--     record_order_payment, close_shift, approve_stock_take,
--     process_sales_return, issue_supplier_payment, ...), which bypasses
--     RLS entirely and is therefore completely unaffected by this
--     migration. Locking UPDATE down on these five is zero-risk.
--   - orders: two real call sites existed (DashboardToday.tsx,
--     POS.tsx's handleSettleDebtOrder/handleSettleAllDebt).
--     DashboardToday.tsx was confirmed dead (never imported anywhere,
--     same pattern as every other orphaned dashboard variant found this
--     project) and deleted outright. The two POS.tsx sites were real,
--     live bugs independent of this permissions work -- they wrote
--     orders.paid_amount directly instead of calling
--     record_order_payment, so that cash never got a payments row, an
--     order_history entry, or shift attribution. Both were fixed to call
--     record_order_payment (commit alongside this migration) before this
--     lockdown, so no legitimate orders UPDATE path remains outside RPCs
--     either.
--
-- Same role set as the DELETE policies already added in 20261114000001
-- (owner/admin/manager) for consistency -- this migration only adds the
-- mirror UPDATE policy per table, it does not touch SELECT/INSERT/DELETE.
-- =============================================================================

DO $$
DECLARE
  t TEXT;
  financial_tables TEXT[] := ARRAY['orders', 'order_items', 'payments', 'shifts', 'shift_entries', 'sales_returns'];
BEGIN
  FOREACH t IN ARRAY financial_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_update ON %I;', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_tenant_update ON %I
        FOR UPDATE USING (
          app_is_super_admin()
          OR (tenant_id = app_current_tenant_id() AND app_current_role() IN ('owner', 'admin', 'manager'))
        )
        WITH CHECK (
          app_is_super_admin()
          OR (tenant_id = app_current_tenant_id() AND app_current_role() IN ('owner', 'admin', 'manager'))
        );
    $p$, t, t);
  END LOOP;
END $$;
