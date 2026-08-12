-- ==========================================
-- SENE CLOUD ERP - INVENTORY RECONCILIATION
-- SCHEMA MIGRATION: postgreSQL / Supabase
-- Target Standards: IFRS (Perpetual Inventory), immutable audit records
-- ==========================================

-- 1. Create custom types if they don't exist
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

-- 2. Create Header Table: inventory_adjustments
CREATE TABLE IF NOT EXISTS inventory_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    reference_number TEXT NOT NULL UNIQUE,
    status adjustment_status NOT NULL DEFAULT 'Draft',
    adjustment_type adjustment_reason_type NOT NULL DEFAULT 'Physical Count',
    created_by TEXT NOT NULL, -- Link to staff id
    created_by_name TEXT,     -- Redundant name for static audit integrity
    approved_by TEXT,         -- Link to staff id of the manager/admin
    approved_by_name TEXT,    -- Redundant name for static audit integrity
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create Details Table: adjustment_items
CREATE TABLE IF NOT EXISTS adjustment_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    adjustment_id UUID NOT NULL REFERENCES inventory_adjustments(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL, -- Link to inventory item id
    product_name TEXT,        -- Snapshot of the name at the moment of reconciliation
    system_qty NUMERIC(12, 2) NOT NULL,
    physical_qty NUMERIC(12, 2) NOT NULL,
    variance_qty NUMERIC(12, 2) NOT NULL, -- Calculated as (physical_qty - system_qty)
    unit_cost NUMERIC(12, 2) NOT NULL, -- Weighted Average Cost (WAC) at reconciliation time
    total_variance_cost NUMERIC(12, 2) NOT NULL, -- Calculated as (variance_qty * unit_cost)
    reason TEXT,              -- Row-specific explanation
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Enable Row Level Security (RLS) for absolute multi-tenant isolation
ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjustment_items ENABLE ROW LEVEL SECURITY;

-- 5. Drop old policies if they exist and create brand new ones
DROP POLICY IF EXISTS tenant_isolation_inventory_adjustments ON inventory_adjustments;
CREATE POLICY tenant_isolation_inventory_adjustments ON inventory_adjustments
    FOR ALL
    TO authenticated
    USING (tenant_id = (SELECT coalesce(nullif(current_setting('app.current_tenant_id', true), ''), '00000000-0000-0000-0000-000000000000')))
    WITH CHECK (tenant_id = (SELECT coalesce(nullif(current_setting('app.current_tenant_id', true), ''), '00000000-0000-0000-0000-000000000000')));

DROP POLICY IF EXISTS tenant_isolation_adjustment_items ON adjustment_items;
CREATE POLICY tenant_isolation_adjustment_items ON adjustment_items
    FOR ALL
    TO authenticated
    USING (tenant_id = (SELECT coalesce(nullif(current_setting('app.current_tenant_id', true), ''), '00000000-0000-0000-0000-000000000000')))
    WITH CHECK (tenant_id = (SELECT coalesce(nullif(current_setting('app.current_tenant_id', true), ''), '00000000-0000-0000-0000-000000000000')));

-- 6. Trigger to auto-update the updated_at timestamp on header updates
CREATE OR REPLACE FUNCTION update_inventory_adjustments_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_inventory_adjustments_updated_at ON inventory_adjustments;
CREATE TRIGGER set_inventory_adjustments_updated_at
    BEFORE UPDATE ON inventory_adjustments
    FOR EACH ROW
    EXECUTE FUNCTION update_inventory_adjustments_timestamp();

-- 7. Indexing for performance and rapid search
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_tenant_branch ON inventory_adjustments(tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_ref ON inventory_adjustments(reference_number);
CREATE INDEX IF NOT EXISTS idx_adjustment_items_adj_id ON adjustment_items(adjustment_id);
