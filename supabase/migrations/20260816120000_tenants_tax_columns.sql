-- Documents columns that already exist in production (added previously via the
-- Supabase dashboard Table Editor, never captured in a migration) so that any
-- fresh schema bootstrap (e.g. a new staging project) matches production.
-- Discovered when onboarding completion failed on a freshly bootstrapped
-- project with "column is_tax_enabled/default_tax_rate does not exist".
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_tax_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_tax_rate NUMERIC NOT NULL DEFAULT 15;
