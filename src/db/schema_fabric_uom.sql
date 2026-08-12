-- ======================================================================
-- SEEN CLOUD ERP - FABRIC UNIT OF MEASURE (UOM) & CONVERSION SCHEMA
-- SCHEMA MIGRATION: PostgreSQL / Supabase
-- Target Standards: Multi-Tenant Isolation, Precision Inventory, Audit Integrity
-- ======================================================================

-- 1. Create fabric_uoms Table (Defines customized units available for fabrics)
CREATE TABLE IF NOT EXISTS fabric_uoms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,          -- e.g., "طاقة", "لفة", "متر"
    name_en TEXT,               -- e.g., "Roll", "Bolt", "Meter"
    symbol TEXT,                -- e.g., "ط", "م"
    is_base BOOLEAN DEFAULT false NOT NULL, -- True if this is the absolute base storage unit (e.g., Meter)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (tenant_id, name)
);

-- 2. Create item_uom_conversions Table (Defines conversion rate for a specific fabric item)
CREATE TABLE IF NOT EXISTS item_uom_conversions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    item_id TEXT NOT NULL,     -- References public.inventory_items(id)
    from_unit TEXT NOT NULL,    -- Larger Unit Name/ID (e.g., "roll", "bolt")
    to_unit TEXT NOT NULL,      -- Base Unit Name/ID (e.g., "meter")
    conversion_rate NUMERIC(12, 4) NOT NULL DEFAULT 1.0, -- e.g., 1 roll = 25.0 meters (so rate = 25.0)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (tenant_id, item_id, from_unit, to_unit)
);

-- 3. Create uom_conversion_logs Table (Tracks manual unrolling / splitting of larger units)
CREATE TABLE IF NOT EXISTS uom_conversion_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    staff_id TEXT NOT NULL,
    staff_name TEXT NOT NULL,
    from_unit TEXT NOT NULL,
    to_unit TEXT NOT NULL,
    converted_qty NUMERIC(12, 4) NOT NULL,    -- Quantity in from_unit (e.g., 1.0 roll)
    resulting_qty NUMERIC(12, 4) NOT NULL,    -- Quantity in to_unit (e.g., 25.0 meters)
    conversion_rate NUMERIC(12, 4) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Enable Row Level Security (RLS) for multi-tenant isolation
ALTER TABLE fabric_uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_uom_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE uom_conversion_logs ENABLE ROW LEVEL SECURITY;

-- 5. Drop old policies if they exist and create brand new ones
DROP POLICY IF EXISTS tenant_isolation_fabric_uoms ON fabric_uoms;
CREATE POLICY tenant_isolation_fabric_uoms ON fabric_uoms
    FOR ALL
    TO authenticated
    USING (tenant_id = (SELECT coalesce(nullif(current_setting('app.current_tenant_id', true), ''), '00000000-0000-0000-0000-000000000000')))
    WITH CHECK (tenant_id = (SELECT coalesce(nullif(current_setting('app.current_tenant_id', true), ''), '00000000-0000-0000-0000-000000000000')));

DROP POLICY IF EXISTS tenant_isolation_item_uom_conversions ON item_uom_conversions;
CREATE POLICY tenant_isolation_item_uom_conversions ON item_uom_conversions
    FOR ALL
    TO authenticated
    USING (tenant_id = (SELECT coalesce(nullif(current_setting('app.current_tenant_id', true), ''), '00000000-0000-0000-0000-000000000000')))
    WITH CHECK (tenant_id = (SELECT coalesce(nullif(current_setting('app.current_tenant_id', true), ''), '00000000-0000-0000-0000-000000000000')));

DROP POLICY IF EXISTS tenant_isolation_uom_conversion_logs ON uom_conversion_logs;
CREATE POLICY tenant_isolation_uom_conversion_logs ON uom_conversion_logs
    FOR ALL
    TO authenticated
    USING (tenant_id = (SELECT coalesce(nullif(current_setting('app.current_tenant_id', true), ''), '00000000-0000-0000-0000-000000000000')))
    WITH CHECK (tenant_id = (SELECT coalesce(nullif(current_setting('app.current_tenant_id', true), ''), '00000000-0000-0000-0000-000000000000')));

-- 6. Trigger to auto-update the updated_at timestamps
CREATE OR REPLACE FUNCTION update_fabric_uom_timestamps()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_fabric_uoms_updated_at ON fabric_uoms;
CREATE TRIGGER set_fabric_uoms_updated_at
    BEFORE UPDATE ON fabric_uoms
    FOR EACH ROW
    EXECUTE FUNCTION update_fabric_uom_timestamps();

DROP TRIGGER IF EXISTS set_item_uom_conversions_updated_at ON item_uom_conversions;
CREATE TRIGGER set_item_uom_conversions_updated_at
    BEFORE UPDATE ON item_uom_conversions
    FOR EACH ROW
    EXECUTE FUNCTION update_fabric_uom_timestamps();

-- 7. High Performance Indices for Rapid Multi-Tenant Search and Joins
CREATE INDEX IF NOT EXISTS idx_fabric_uoms_tenant ON fabric_uoms(tenant_id);
CREATE INDEX IF NOT EXISTS idx_item_uom_conversions_item ON item_uom_conversions(tenant_id, item_id);
CREATE INDEX IF NOT EXISTS idx_uom_conversion_logs_item ON uom_conversion_logs(tenant_id, item_id);
