-- Same schema drift as the tenants tax columns migration: these existed in
-- production (added via the dashboard, never captured in a migration), so a
-- fresh bootstrap was missing them. Surfaced as "Could not find the
-- 'opening_balance' column of 'inventory_items' in the schema cache" when
-- adding a product on a freshly bootstrapped project.
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS opening_balance NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS show_in_pos BOOLEAN NOT NULL DEFAULT TRUE;
