-- conversion_rate stays "meters per purchase unit". content_unit only records
-- how the shop typed a roll's content (yards or meters) so the UI can show it
-- back the same way; NULL means "show in meters" (every pre-existing row).
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS content_unit text
  CHECK (content_unit IS NULL OR content_unit IN ('meter', 'yard'));

-- base_unit was created by hand on staging only (see 20260817110000); the item
-- form now writes it, so make sure the column exists wherever this runs.
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS base_unit inventory_base_unit;
