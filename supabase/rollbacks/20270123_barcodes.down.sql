-- Rollback of 20270123000000_barcodes.sql. Barcodes already given stay.
DROP TRIGGER IF EXISTS trg_guard_barcode_unique ON public.inventory_items;
DROP TRIGGER IF EXISTS trg_guard_barcode_unique ON public.inventory_variants;
DROP FUNCTION IF EXISTS public.guard_barcode_unique();
DROP FUNCTION IF EXISTS public.is_barcode_available(text);
DROP INDEX IF EXISTS public.uq_inventory_variants_tenant_barcode;
