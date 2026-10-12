-- seen-ux-fixes-batch-task.md #9 -- per-tenant customizable, orderable,
-- hideable categories for inventory and suppliers. Replaces the fixed
-- "أخرى" option in InventoryManager.tsx and Suppliers.tsx with a real
-- per-tenant list a merchant can extend. Seeded lazily on first read by
-- src/services/categoryService.ts (from the fixed legacy list for
-- inventory, or vertical_inventory_categories for a non-legacy vertical --
-- see useVerticalConfig.tsx) rather than backfilled here, since there is no
-- single correct seed per tenant to insert in a migration.
--
-- inventory_items.category / suppliers.category keep writing a legacy-safe
-- value via mapCategoryKeyToLegacyCategory() (inventory only -- the
-- suppliers.category column is already free TEXT); this table only drives
-- what the picker/management UI shows, not the storage columns themselves.

CREATE TABLE IF NOT EXISTS public.tenant_categories (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    scope          TEXT NOT NULL CHECK (scope IN ('inventory', 'supplier')),
    category_key   TEXT NOT NULL,
    label_ar       TEXT NOT NULL,
    display_order  INT NOT NULL DEFAULT 0,
    is_hidden      BOOLEAN NOT NULL DEFAULT FALSE,
    is_custom      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, scope, category_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_categories_tenant_scope
    ON public.tenant_categories (tenant_id, scope, display_order);

ALTER TABLE public.tenant_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_categories FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY tenant_categories_tenant_read ON public.tenant_categories
        FOR SELECT USING (
            app_is_super_admin() OR tenant_id = app_current_tenant_id()
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY tenant_categories_tenant_insert ON public.tenant_categories
        FOR INSERT WITH CHECK (
            app_is_super_admin() OR tenant_id = app_current_tenant_id()
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY tenant_categories_tenant_update ON public.tenant_categories
        FOR UPDATE USING (
            app_is_super_admin() OR tenant_id = app_current_tenant_id()
        )
        WITH CHECK (
            app_is_super_admin() OR tenant_id = app_current_tenant_id()
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE POLICY tenant_categories_tenant_delete ON public.tenant_categories
        FOR DELETE USING (
            app_is_super_admin() OR tenant_id = app_current_tenant_id()
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
