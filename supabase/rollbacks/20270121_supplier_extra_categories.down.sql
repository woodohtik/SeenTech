-- Rollback of 20270121000000_supplier_extra_categories.sql: one category per
-- supplier again (the extra ones are dropped; `category` was never touched).
DROP INDEX IF EXISTS public.suppliers_extra_categories_idx;
ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_extra_categories_size;
ALTER TABLE public.suppliers DROP COLUMN IF EXISTS extra_categories;
