-- seen-merchant-trial-test-2026-11-26.md, phase 3 item 4: a supplier had one
-- category, while an accessories supplier sells buttons and thread together.
-- `category` stays the main one (filters, reports, imports read it); the
-- others go in extra_categories, and the suppliers list matches either.
--
-- Rollback: supabase/rollbacks/20270121_supplier_extra_categories.down.sql
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS extra_categories text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_extra_categories_size;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_extra_categories_size CHECK (cardinality(extra_categories) <= 20);
CREATE INDEX IF NOT EXISTS suppliers_extra_categories_idx ON public.suppliers USING gin (extra_categories);
