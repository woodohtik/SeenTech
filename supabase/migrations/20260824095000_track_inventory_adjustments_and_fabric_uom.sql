-- Closes schema-drift finding from the 2026-09-17 full-team review
-- (database-reviewer): inventory_adjustments/adjustment_items and
-- fabric_uoms/item_uom_conversions/uom_conversion_logs were only ever
-- defined in src/db/schema_inventory_adjustments.sql and
-- src/db/schema_fabric_uom.sql -- both outside supabase/migrations/, so
-- `supabase db reset` cannot reproduce them, and the tracked migration
-- 20260825000000_fix_inventory_adjustments_rls.sql (which ALTERs RLS
-- policies on inventory_adjustments/adjustment_items) would fail outright
-- on a clean reset since those tables wouldn't exist yet at that point.
--
-- RLS on all 5 tables is NOT copied from those src/db files verbatim --
-- verified live on staging on 2026-09-17 that the actual running policies
-- have already been hand-patched (again, out of band, same pattern as
-- app_current_tenant_id()/fix-rls.sql) to different names and bodies
-- using the correct app_current_tenant_id() function instead of the
-- broken current_setting('app.current_tenant_id') the src/db files still
-- read. Those live policy names/bodies are reproduced below so this
-- migration is a no-op on the current database and correct on a fresh one.
-- Types, tables, triggers, and indexes below DID verify identical to the
-- src/db files, so those are translated directly (just made idempotent).

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'adjustment_status') THEN
        CREATE TYPE adjustment_status AS ENUM ('Draft', 'Approved', 'Cancelled');
    END IF;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'adjustment_reason_type') THEN
        CREATE TYPE adjustment_reason_type AS ENUM ('Physical Count', 'Damage', 'Loss', 'Internal Use');
    END IF;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS inventory_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    reference_number TEXT NOT NULL UNIQUE,
    status adjustment_status NOT NULL DEFAULT 'Draft',
    adjustment_type adjustment_reason_type NOT NULL DEFAULT 'Physical Count',
    created_by TEXT NOT NULL,
    created_by_name TEXT,
    approved_by TEXT,
    approved_by_name TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS adjustment_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    adjustment_id UUID NOT NULL REFERENCES inventory_adjustments(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    product_name TEXT,
    system_qty NUMERIC(12, 2) NOT NULL,
    physical_qty NUMERIC(12, 2) NOT NULL,
    variance_qty NUMERIC(12, 2) NOT NULL,
    unit_cost NUMERIC(12, 2) NOT NULL,
    total_variance_cost NUMERIC(12, 2) NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS fabric_uoms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    name_en TEXT,
    symbol TEXT,
    is_base BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS item_uom_conversions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    from_unit TEXT NOT NULL,
    to_unit TEXT NOT NULL,
    conversion_rate NUMERIC(12, 4) NOT NULL DEFAULT 1.0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (tenant_id, item_id, from_unit, to_unit)
);

CREATE TABLE IF NOT EXISTS uom_conversion_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    staff_id TEXT NOT NULL,
    staff_name TEXT NOT NULL,
    from_unit TEXT NOT NULL,
    to_unit TEXT NOT NULL,
    converted_qty NUMERIC(12, 4) NOT NULL,
    resulting_qty NUMERIC(12, 4) NOT NULL,
    conversion_rate NUMERIC(12, 4) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjustment_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fabric_uoms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_uom_conversions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE uom_conversion_logs    ENABLE ROW LEVEL SECURITY;

-- Live policy names/bodies (verified 2026-09-17) -- NOT the stale
-- tenant_isolation_* ones from the src/db files. Note the asymmetry is
-- real and intentional to preserve: inventory_adjustments/adjustment_items
-- have no super_admin bypass live today, the other three do.
DO $$ BEGIN
  CREATE POLICY inventory_adjustments_tenant ON inventory_adjustments
      FOR ALL
      TO authenticated
      USING (tenant_id = app_current_tenant_id()::text)
      WITH CHECK (tenant_id = app_current_tenant_id()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY adjustment_items_tenant ON adjustment_items
      FOR ALL
      TO authenticated
      USING (tenant_id = app_current_tenant_id()::text)
      WITH CHECK (tenant_id = app_current_tenant_id()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY fabric_uoms_tenant ON fabric_uoms
      FOR ALL
      TO authenticated
      USING (app_is_super_admin() OR tenant_id = app_current_tenant_id()::text)
      WITH CHECK (app_is_super_admin() OR tenant_id = app_current_tenant_id()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY item_uom_conversions_tenant ON item_uom_conversions
      FOR ALL
      TO authenticated
      USING (app_is_super_admin() OR tenant_id = app_current_tenant_id()::text)
      WITH CHECK (app_is_super_admin() OR tenant_id = app_current_tenant_id()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY uom_conversion_logs_tenant ON uom_conversion_logs
      FOR ALL
      TO authenticated
      USING (app_is_super_admin() OR tenant_id = app_current_tenant_id()::text)
      WITH CHECK (app_is_super_admin() OR tenant_id = app_current_tenant_id()::text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION update_inventory_adjustments_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_fabric_uom_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER set_inventory_adjustments_updated_at
      BEFORE UPDATE ON inventory_adjustments
      FOR EACH ROW
      EXECUTE FUNCTION update_inventory_adjustments_timestamp();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_fabric_uoms_updated_at
      BEFORE UPDATE ON fabric_uoms
      FOR EACH ROW
      EXECUTE FUNCTION update_fabric_uom_timestamps();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER set_item_uom_conversions_updated_at
      BEFORE UPDATE ON item_uom_conversions
      FOR EACH ROW
      EXECUTE FUNCTION update_fabric_uom_timestamps();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_tenant_branch ON inventory_adjustments(tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_ref ON inventory_adjustments(reference_number);
CREATE INDEX IF NOT EXISTS idx_adjustment_items_adj_id ON adjustment_items(adjustment_id);
CREATE INDEX IF NOT EXISTS idx_fabric_uoms_tenant ON fabric_uoms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_item_uom_conversions_item ON item_uom_conversions(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_uom_conversion_logs_item ON uom_conversion_logs(tenant_id, item_id);
