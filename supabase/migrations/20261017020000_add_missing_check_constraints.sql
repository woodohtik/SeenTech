-- seen-deep-technical-audit.md Medium tier: missing CHECK constraints.
-- Defense-in-depth alongside app logic that is already correct today
-- (apply_stock_movement already enforces >= 0 at the RPC layer, and the
-- client always computes paid_amount <= total_amount) -- these constraints
-- make that invariant hold at the DB layer too, so any future code path
-- that writes these tables directly (bypassing the RPC/client logic) can't
-- silently corrupt the numbers.
--
-- Verified against both staging and production data before writing this:
-- every row already satisfied every constraint below. (An earlier draft of
-- this migration flagged one violating branch_inventory row, tenant
-- "تجربة" -- that row was cleaned up before this ever ran for real; confirmed
-- live on both environments, 2026-10-19, that all six constraints below are
-- already active with zero violations, so there is nothing left to resolve.)
--
-- مراجعة-الفريق-التقني-الكامل-2026-10-19.md (قاعدة بيانات، عالية): كانت كل
-- عبارة ADD CONSTRAINT هنا بلا أي حارس DO $$ EXCEPTION (بعكس كل ملف آخر
-- حسّاس لإعادة التشغيل في هذا المشروع) -- PostgreSQL لا يدعم
-- ADD CONSTRAINT IF NOT EXISTS، فإعادة تشغيل هذا الملف على بيئة طُبِّق
-- عليها مسبقاً كانت ستفشل بخطأ "already exists" وتوقف باقي عبارات الملف في
-- المنتصف. أُضيفت الحراسة الآن بنفس النمط المستخدَم في بقية المشروع.

DO $$ BEGIN
  ALTER TABLE public.inventory_items
    ADD CONSTRAINT chk_inventory_items_quantity CHECK (quantity >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.branch_inventory
    ADD CONSTRAINT chk_branch_inventory_quantity CHECK (quantity >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.branch_inventory
    ADD CONSTRAINT chk_branch_inventory_reserved CHECK (reserved >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.orders
    ADD CONSTRAINT chk_orders_paid_le_total CHECK (paid_amount <= total_amount);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.purchase_orders
    ADD CONSTRAINT chk_purchase_orders_total_nonneg CHECK (total_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.purchase_orders
    ADD CONSTRAINT chk_purchase_orders_paid_nonneg CHECK (paid_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.purchase_orders
    ADD CONSTRAINT chk_purchase_orders_paid_le_total CHECK (paid_amount <= total_amount);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tax_invoices
    ADD CONSTRAINT chk_tax_invoices_subtotal_nonneg CHECK (subtotal >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tax_invoices
    ADD CONSTRAINT chk_tax_invoices_tax_rate_nonneg CHECK (tax_rate >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tax_invoices
    ADD CONSTRAINT chk_tax_invoices_tax_amount_nonneg CHECK (tax_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tax_invoices
    ADD CONSTRAINT chk_tax_invoices_discount_nonneg CHECK (discount_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tax_invoices
    ADD CONSTRAINT chk_tax_invoices_total_nonneg CHECK (total_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tax_invoices
    ADD CONSTRAINT chk_tax_invoices_paid_nonneg CHECK (paid_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
