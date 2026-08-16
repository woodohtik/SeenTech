-- Full production-vs-staging column reconciliation (requested after the
-- tenants/inventory_items drift fixes kept surfacing one at a time). These
-- four columns exist in production only, added via the dashboard at some
-- point and never captured in any tracked migration:
--
--   customers.company_name / customers.vat_number — actively written by the
--     "add customer" B2B fields (Customers.tsx); missing on staging would
--     break customer creation the same way opening_balance/show_in_pos did.
--
--   staff.commission_balance / users.has_seen_tour — not referenced by any
--     current code path (dead/orphaned columns in production, likely from an
--     earlier design later reworked). Added here anyway purely for schema
--     parity with production, since staging exists to mirror it.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name VARCHAR;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS vat_number VARCHAR;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS commission_balance NUMERIC DEFAULT 0.00;
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_seen_tour BOOLEAN NOT NULL DEFAULT FALSE;
