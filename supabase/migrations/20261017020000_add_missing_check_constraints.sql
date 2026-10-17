-- seen-deep-technical-audit.md Medium tier: missing CHECK constraints.
-- Defense-in-depth alongside app logic that is already correct today
-- (apply_stock_movement already enforces >= 0 at the RPC layer, and the
-- client always computes paid_amount <= total_amount) -- these constraints
-- make that invariant hold at the DB layer too, so any future code path
-- that writes these tables directly (bypassing the RPC/client logic) can't
-- silently corrupt the numbers.
--
-- Verified against both staging and production data before writing this:
-- every row already satisfies every constraint below EXCEPT one production
-- branch_inventory row (quantity = -2, tenant "تجربة", item "قماش اختبار
-- QA") -- flagged separately to the user; the branch_inventory constraint
-- is applied to staging only until that row is resolved.

ALTER TABLE public.inventory_items
  ADD CONSTRAINT chk_inventory_items_quantity CHECK (quantity >= 0);

ALTER TABLE public.branch_inventory
  ADD CONSTRAINT chk_branch_inventory_quantity CHECK (quantity >= 0),
  ADD CONSTRAINT chk_branch_inventory_reserved CHECK (reserved >= 0);

ALTER TABLE public.orders
  ADD CONSTRAINT chk_orders_paid_le_total CHECK (paid_amount <= total_amount);

ALTER TABLE public.purchase_orders
  ADD CONSTRAINT chk_purchase_orders_total_nonneg CHECK (total_amount >= 0),
  ADD CONSTRAINT chk_purchase_orders_paid_nonneg CHECK (paid_amount >= 0),
  ADD CONSTRAINT chk_purchase_orders_paid_le_total CHECK (paid_amount <= total_amount);

ALTER TABLE public.tax_invoices
  ADD CONSTRAINT chk_tax_invoices_subtotal_nonneg CHECK (subtotal >= 0),
  ADD CONSTRAINT chk_tax_invoices_tax_rate_nonneg CHECK (tax_rate >= 0),
  ADD CONSTRAINT chk_tax_invoices_tax_amount_nonneg CHECK (tax_amount >= 0),
  ADD CONSTRAINT chk_tax_invoices_discount_nonneg CHECK (discount_amount >= 0),
  ADD CONSTRAINT chk_tax_invoices_total_nonneg CHECK (total_amount >= 0),
  ADD CONSTRAINT chk_tax_invoices_paid_nonneg CHECK (paid_amount >= 0);
