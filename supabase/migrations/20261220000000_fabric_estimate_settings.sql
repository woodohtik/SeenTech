-- Shop-level numbers for the fabric-per-garment estimate (waste allowance,
-- default cloth width, narrow-cloth threshold). NULL means "use the app
-- defaults". Not in the owner self-edit allow-list on purpose: it is written
-- only through /api/tenant/settings (service role), like the tax settings.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS fabric_estimate_settings jsonb;

-- Optional cloth width per fabric item; the estimate falls back to the shop
-- default when it is NULL.
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS fabric_width_cm numeric(6,1)
  CHECK (fabric_width_cm IS NULL OR fabric_width_cm > 0);
