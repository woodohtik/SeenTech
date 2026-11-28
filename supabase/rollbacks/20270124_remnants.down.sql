-- Rollback of 20270124000004_remnants.sql. Remnant items already made stay (ordinary items).
DROP FUNCTION IF EXISTS public.convert_to_remnant(uuid, uuid, numeric, numeric);
DROP INDEX IF EXISTS public.idx_inventory_items_remnants;
ALTER TABLE public.inventory_items DROP COLUMN IF EXISTS remnant_meters;
ALTER TABLE public.inventory_items DROP COLUMN IF EXISTS remnant_of;
