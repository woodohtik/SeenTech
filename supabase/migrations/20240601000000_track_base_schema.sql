-- Closes schema-drift finding from the 2026-09-17 full-team review
-- (مراجعة-الفريق-التقني-الكامل-2026-09-17.md, database-reviewer point #8):
-- the entire foundational schema (~30 tables, ~25 enum types, every base
-- index and RLS policy) has only ever lived in
-- supabase/legacy-setup/wdooh-database-schema.sql -- a file run by hand,
-- never tracked as a migration, so `supabase db reset` / a fresh
-- environment cannot reproduce it.
--
-- This migration is a byte-for-byte structural copy of that file, made
-- idempotent (IF NOT EXISTS / duplicate_object guards everywhere) so that
-- applying it to an already-provisioned database (staging, production) is
-- a total no-op, while applying it to a brand-new database reproduces the
-- original schema exactly. It is deliberately dated BEFORE every other
-- tracked migration (2024-06-01, ahead of the earliest existing file,
-- 20240704_tailor_commissions.sql) so a from-scratch rebuild creates this
-- foundation first, then replays every later migration on top of it.
--
-- Two functions below (app_current_tenant_id, app_is_super_admin) are
-- known to have been hand-patched directly on staging after this file was
-- first run, via the untracked scripts/legacy-oneoff/fix-rls.sql. Those
-- corrected versions are tracked separately and later in migration order
-- (20260917040000_track_app_current_tenant_id.sql and
-- 20260917080000_track_remaining_rls_patches.sql), so this migration only
-- creates the ORIGINAL bodies when the function does not exist yet
-- (fresh DB) and never touches them if they already exist (staging,
-- production) -- it must never CREATE OR REPLACE these two, or it would
-- silently reinstate the pre-fix, always-NULL behavior on every push.
-- Every other object here (tables, types, indexes, the remaining
-- policies) has no known drift, so it is safe to translate literally.

-- Extensions ------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";    -- case-insensitive email/phone
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- verified live on staging 2026-09-17; needed by idx_customers_tenant_name_trgm below

-- =============================================================================
-- Helper: tenant context resolver used by every RLS policy.
-- Original bodies only -- see note above. On a DB that already has these
-- functions (i.e. anywhere this schema was previously hand-applied), this
-- is a no-op and the live, corrected version is left untouched.
-- =============================================================================

DO $guard_tenant_fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'app_current_tenant_id' AND n.nspname = 'public'
  ) THEN
    EXECUTE $exec_tenant_fn$
      CREATE FUNCTION app_current_tenant_id()
      RETURNS UUID
      LANGUAGE SQL
      STABLE
      AS $fnbody_tenant$
          SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
      $fnbody_tenant$;
    $exec_tenant_fn$;
  END IF;
END
$guard_tenant_fn$;

DO $guard_admin_fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'app_is_super_admin' AND n.nspname = 'public'
  ) THEN
    EXECUTE $exec_admin_fn$
      CREATE FUNCTION app_is_super_admin()
      RETURNS BOOLEAN
      LANGUAGE SQL
      STABLE
      AS $fnbody_admin$
          SELECT COALESCE(NULLIF(current_setting('app.is_super_admin', true), ''), 'false')::boolean
      $fnbody_admin$;
    $exec_admin_fn$;
  END IF;
END
$guard_admin_fn$;

-- =============================================================================
-- ENUM types
-- =============================================================================

DO $$ BEGIN CREATE TYPE tenant_status AS ENUM ('active', 'inactive', 'pending'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE inventory_strategy AS ENUM ('centralized', 'decentralized'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE layout_mode AS ENUM ('sidebar', 'grid'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE saas_user_role AS ENUM ('super_admin', 'support_tech', 'billing_admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'super_admin', 'support_tech', 'billing_admin',
    'owner', 'admin', 'manager', 'cashier', 'tailor',
    'accountant', 'branch_manager', 'warehouse_manager'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE staff_status AS ENUM ('active', 'inactive'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE branch_type AS ENUM ('warehouse', 'store'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE inventory_category AS ENUM (
    'fabric', 'thread', 'button', 'lining',
    'accessories', 'ready_made', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE inventory_unit AS ENUM (
    'meter', 'yard', 'roll', 'bolt', 'piece', 'spool', 'box'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE inventory_base_unit AS ENUM ('meter', 'piece'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM (
    'cash', 'network', 'bank_transfer', 'cash_on_delivery', 'partial'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'measurements_taken', 'cutting', 'sewing', 'embroidery',
    'ironing_packaging', 'ready', 'partial_delivered',
    'delivered', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE order_item_type AS ENUM ('custom', 'ready_made'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE closure_type AS ENUM ('zipper', 'buttons'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE closure_visibility AS ENUM ('hidden', 'visible'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE collar_padding AS ENUM ('hard', 'soft'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE purchase_order_status AS ENUM ('draft', 'sent', 'received', 'returned'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE transfer_status AS ENUM (
    'draft', 'pending', 'in_transit', 'completed', 'rejected', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE stock_movement_type AS ENUM (
    'addition', 'deduction', 'transfer_in', 'transfer_out',
    'reconciliation', 'adjustment', 'sale'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE shift_status AS ENUM ('open', 'closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE shift_entry_type AS ENUM ('payout', 'deposit'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE tailor_request_status AS ENUM ('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE notification_type AS ENUM ('inventory', 'order', 'system', 'alert'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE notification_status AS ENUM ('unread', 'read'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM (
    'draft', 'issued', 'paid', 'partially_paid', 'refunded', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE sales_return_status AS ENUM ('pending', 'approved', 'rejected', 'completed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE audit_log_type AS ENUM ('deletion', 'security', 'system'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- Global (platform-wide) tables — NOT tenant-scoped
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,             -- Firebase UID
    email           CITEXT NOT NULL UNIQUE,
    display_name    TEXT,
    phone           TEXT,
    photo_url       TEXT,
    email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    disabled        BOOLEAN NOT NULL DEFAULT FALSE,
    last_sign_in_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS plans (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    price        NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    features     JSONB NOT NULL DEFAULT '[]'::jsonb,
    max_staff    INTEGER NOT NULL DEFAULT 1 CHECK (max_staff >= 0),
    max_orders   INTEGER NOT NULL DEFAULT 0 CHECK (max_orders >= 0),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id           TEXT UNIQUE,                       -- old Firestore doc id for migration
    customer_id         TEXT UNIQUE,                       -- business-facing public identifier
    owner_uid           TEXT REFERENCES users(id) ON DELETE SET NULL,
    name                TEXT NOT NULL,
    owner_email         CITEXT NOT NULL,
    phone               TEXT NOT NULL,
    address             TEXT,
    vat_number          TEXT,
    commercial_register TEXT,
    status              tenant_status NOT NULL DEFAULT 'pending',
    plan_id             TEXT REFERENCES plans(id) ON DELETE SET NULL,
    inventory_strategy  inventory_strategy NOT NULL DEFAULT 'centralized',
    logo_url            TEXT,
    default_layout      layout_mode NOT NULL DEFAULT 'sidebar',
    is_test             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_status     ON tenants (status);
CREATE INDEX IF NOT EXISTS idx_tenants_plan_id    ON tenants (plan_id);
CREATE INDEX IF NOT EXISTS idx_tenants_owner_uid  ON tenants (owner_uid);
CREATE INDEX IF NOT EXISTS idx_tenants_owner_email ON tenants (owner_email);

CREATE TABLE IF NOT EXISTS saas_users (
    uid           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    email         CITEXT NOT NULL UNIQUE,
    role          saas_user_role NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    mfa_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saas_users_role ON saas_users (role);

CREATE TABLE IF NOT EXISTS saas_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saas_security_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
    user_email  CITEXT,
    action      TEXT NOT NULL,
    details     TEXT,
    ip_address  INET,
    user_agent  TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saas_security_logs_user     ON saas_security_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_saas_security_logs_occurred ON saas_security_logs (occurred_at DESC);

CREATE TABLE IF NOT EXISTS tailor_requests (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uid              TEXT REFERENCES users(id) ON DELETE SET NULL,
    customer_id      TEXT,
    name             TEXT NOT NULL,
    phone            TEXT NOT NULL,
    email            CITEXT NOT NULL,
    shop_name        TEXT,
    shop_phone       TEXT,
    address          TEXT,
    onboarding_step  SMALLINT CHECK (onboarding_step BETWEEN 0 AND 6),
    status           tailor_request_status NOT NULL DEFAULT 'pending',
    approved_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
    approved_at      TIMESTAMPTZ,
    tenant_id        UUID REFERENCES tenants(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tailor_requests_status ON tailor_requests (status);
CREATE INDEX IF NOT EXISTS idx_tailor_requests_uid    ON tailor_requests (uid);
CREATE INDEX IF NOT EXISTS idx_tailor_requests_email  ON tailor_requests (email);

-- =============================================================================
-- Tenant-scoped operational tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS branches (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    location    TEXT NOT NULL,
    phone       TEXT,
    type        branch_type NOT NULL DEFAULT 'store',
    is_main     BOOLEAN NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_branches_tenant     ON branches (tenant_id);
CREATE INDEX IF NOT EXISTS idx_branches_type       ON branches (tenant_id, type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_one_main
    ON branches (tenant_id) WHERE is_main;

CREATE TABLE IF NOT EXISTS roles (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL for 'system' roles
    role_key     TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    permissions  JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_default   BOOLEAN NOT NULL DEFAULT FALSE,
    is_system    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_tenant_key ON roles (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), role_key);
CREATE INDEX IF NOT EXISTS idx_roles_tenant            ON roles (tenant_id);

CREATE TABLE IF NOT EXISTS staff (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    uid               TEXT REFERENCES users(id) ON DELETE SET NULL,
    name              TEXT NOT NULL,
    email             CITEXT NOT NULL,
    phone             TEXT,
    role              user_role NOT NULL,
    role_id           UUID REFERENCES roles(id) ON DELETE SET NULL,
    branch_id         UUID REFERENCES branches(id) ON DELETE SET NULL,
    status            staff_status NOT NULL DEFAULT 'active',
    pin_hash          TEXT,                     -- bcrypt/argon2 hash, never plaintext
    must_change_pin   BOOLEAN NOT NULL DEFAULT FALSE,
    is_test           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_tenant_email ON staff (tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_staff_tenant              ON staff (tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_tenant_status       ON staff (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_staff_branch              ON staff (branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_uid                 ON staff (uid);
CREATE INDEX IF NOT EXISTS idx_staff_role_id             ON staff (role_id);

CREATE TABLE IF NOT EXISTS user_permission_overrides (
    staff_id     UUID PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    overrides    JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_perm_overrides_tenant ON user_permission_overrides (tenant_id);

CREATE TABLE IF NOT EXISTS customers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    phone         TEXT NOT NULL,
    email         CITEXT,
    measurements  JSONB NOT NULL DEFAULT '{}'::jsonb,  -- thobe, cuff, collar, sleeve, etc.
    styles        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- neckShape, sleeveStyle, pocketType
    notes         TEXT,
    is_test       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant          ON customers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone    ON customers (tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_name_trgm
    ON customers USING GIN (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS suppliers (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    contact_person TEXT,
    email          CITEXT,
    phone          TEXT,
    address        TEXT,
    tax_number     TEXT,
    category       TEXT,
    balance        NUMERIC(14,2) NOT NULL DEFAULT 0,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant      ON suppliers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_name ON suppliers (tenant_id, name);

CREATE TABLE IF NOT EXISTS inventory_items (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    supplier_id      UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    name             TEXT NOT NULL,
    description      TEXT,
    category         inventory_category NOT NULL,
    unit             inventory_unit NOT NULL,
    base_unit        inventory_base_unit NOT NULL,
    conversion_rate  NUMERIC(12,4) NOT NULL CHECK (conversion_rate > 0),
    min_threshold    NUMERIC(14,4) NOT NULL DEFAULT 0,
    price_per_unit   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (price_per_unit >= 0),
    sku              TEXT NOT NULL,
    barcode          TEXT,
    quantity         NUMERIC(14,4) NOT NULL DEFAULT 0, -- central / aggregate
    images           JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Optional ready-made style attributes
    collar_type      TEXT,
    cuff_type        TEXT,
    pocket_type      TEXT,
    chest_style      TEXT,
    is_test          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_tenant_sku     ON inventory_items (tenant_id, sku);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_items_tenant_barcode ON inventory_items (tenant_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant               ON inventory_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category             ON inventory_items (tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_inventory_items_supplier             ON inventory_items (supplier_id);

CREATE TABLE IF NOT EXISTS inventory_variants (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    item_id           UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    sku               TEXT NOT NULL,
    barcode           TEXT,
    name              TEXT NOT NULL,
    options           JSONB NOT NULL DEFAULT '{}'::jsonb,
    price_adjustment  NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_variants_tenant_sku ON inventory_variants (tenant_id, sku);
CREATE INDEX IF NOT EXISTS idx_inventory_variants_tenant            ON inventory_variants (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_variants_item              ON inventory_variants (item_id);

CREATE TABLE IF NOT EXISTS branch_inventory (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    item_id     UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    variant_id  UUID REFERENCES inventory_variants(id) ON DELETE CASCADE,
    quantity    NUMERIC(14,4) NOT NULL DEFAULT 0,
    reserved    NUMERIC(14,4) NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_inventory_branch_item
    ON branch_inventory (branch_id, item_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_branch_inventory_tenant ON branch_inventory (tenant_id);
CREATE INDEX IF NOT EXISTS idx_branch_inventory_branch ON branch_inventory (branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_inventory_item   ON branch_inventory (item_id);

CREATE TABLE IF NOT EXISTS stock_transfers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    from_branch_id    UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    to_branch_id      UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    status            transfer_status NOT NULL DEFAULT 'draft',
    requested_by      UUID REFERENCES staff(id) ON DELETE SET NULL,
    requested_by_name TEXT,
    shipped_by        UUID REFERENCES staff(id) ON DELETE SET NULL,
    received_by       UUID REFERENCES staff(id) ON DELETE SET NULL,
    notes             TEXT,
    remarks           TEXT,
    shipped_at        TIMESTAMPTZ,
    received_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (from_branch_id <> to_branch_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_tenant ON stock_transfers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from   ON stock_transfers (from_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to     ON stock_transfers (to_branch_id);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    transfer_id         UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    item_id             UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    item_name           TEXT NOT NULL,
    requested_quantity  NUMERIC(14,4) NOT NULL CHECK (requested_quantity > 0),
    shipped_quantity    NUMERIC(14,4),
    received_quantity   NUMERIC(14,4),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_tenant   ON stock_transfer_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer ON stock_transfer_items (transfer_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_item     ON stock_transfer_items (item_id);

CREATE TABLE IF NOT EXISTS stock_ledger (
    id                 BIGSERIAL PRIMARY KEY,
    tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id          UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    item_id            UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    variant_id         UUID REFERENCES inventory_variants(id) ON DELETE SET NULL,
    type               stock_movement_type NOT NULL,
    previous_quantity  NUMERIC(14,4) NOT NULL,
    new_quantity       NUMERIC(14,4) NOT NULL,
    change             NUMERIC(14,4) NOT NULL,
    reference_id       UUID,           -- order/transfer/reconciliation
    reference_type     TEXT,           -- free text discriminator
    staff_id           UUID REFERENCES staff(id) ON DELETE SET NULL,
    staff_name         TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_tenant_time ON stock_ledger (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_item        ON stock_ledger (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_branch      ON stock_ledger (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_reference   ON stock_ledger (reference_id);

CREATE TABLE IF NOT EXISTS inventory_reconciliations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id         UUID REFERENCES branches(id) ON DELETE SET NULL,
    item_id           UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    item_name         TEXT NOT NULL,
    previous_quantity NUMERIC(14,4) NOT NULL,
    actual_quantity   NUMERIC(14,4) NOT NULL,
    difference        NUMERIC(14,4) NOT NULL,
    reason            TEXT NOT NULL,
    staff_id          UUID REFERENCES staff(id) ON DELETE SET NULL,
    staff_name        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_reconciliations_tenant ON inventory_reconciliations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_reconciliations_item   ON inventory_reconciliations (item_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id         UUID REFERENCES branches(id) ON DELETE SET NULL,
    supplier_id       UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    po_number         TEXT NOT NULL,
    total_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    paid_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
    remaining_amount  NUMERIC(14,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
    status            purchase_order_status NOT NULL DEFAULT 'draft',
    order_date        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expected_date     TIMESTAMPTZ,
    received_date     TIMESTAMPTZ,
    notes             TEXT,
    created_by        UUID REFERENCES staff(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_tenant_po ON purchase_orders (tenant_id, po_number);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant          ON purchase_orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier        ON purchase_orders (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status          ON purchase_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_date            ON purchase_orders (tenant_id, order_date DESC);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    purchase_order_id  UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    item_id            UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
    name               TEXT NOT NULL,
    quantity           NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
    unit               inventory_unit NOT NULL,
    conversion_rate    NUMERIC(12,4) NOT NULL CHECK (conversion_rate > 0),
    base_quantity      NUMERIC(14,4) NOT NULL,
    price_per_unit     NUMERIC(14,2) NOT NULL CHECK (price_per_unit >= 0),
    total              NUMERIC(14,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_po_items_tenant ON purchase_order_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_po_items_po     ON purchase_order_items (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_items_item   ON purchase_order_items (item_id);

CREATE TABLE IF NOT EXISTS purchase_returns (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    purchase_order_id   UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    branch_id           UUID REFERENCES branches(id) ON DELETE SET NULL,
    return_number       TEXT NOT NULL,
    total_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
    reason              TEXT,
    return_date         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by          UUID REFERENCES staff(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_returns_tenant_num ON purchase_returns (tenant_id, return_number);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_tenant           ON purchase_returns (tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_po               ON purchase_returns (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier         ON purchase_returns (supplier_id);

CREATE TABLE IF NOT EXISTS purchase_return_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    purchase_return_id  UUID NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
    item_id             UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
    name                TEXT NOT NULL,
    quantity            NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
    unit                inventory_unit NOT NULL,
    conversion_rate     NUMERIC(12,4) NOT NULL DEFAULT 1,
    base_quantity       NUMERIC(14,4) NOT NULL,
    price_per_unit      NUMERIC(14,2) NOT NULL,
    total               NUMERIC(14,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pr_items_tenant ON purchase_return_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pr_items_return ON purchase_return_items (purchase_return_id);

CREATE TABLE IF NOT EXISTS shifts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id           UUID REFERENCES branches(id) ON DELETE SET NULL,
    staff_id            UUID NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
    staff_name          TEXT NOT NULL,
    opening_balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
    closing_balance     NUMERIC(14,2),
    actual_cash         NUMERIC(14,2),
    expected_cash       NUMERIC(14,2),
    discrepancy         NUMERIC(14,2),
    discrepancy_reason  TEXT,
    totals              JSONB NOT NULL DEFAULT '{}'::jsonb,  -- cash, card, returns, discounts, taxes
    status              shift_status NOT NULL DEFAULT 'open',
    notes               TEXT,
    start_time          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_time            TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shifts_tenant         ON shifts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_shifts_tenant_status  ON shifts (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_shifts_staff          ON shifts (staff_id);
CREATE INDEX IF NOT EXISTS idx_shifts_branch_status  ON shifts (branch_id, status);
CREATE INDEX IF NOT EXISTS idx_shifts_start          ON shifts (tenant_id, start_time DESC);

CREATE TABLE IF NOT EXISTS shift_entries (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shift_id     UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    entry_type   shift_entry_type NOT NULL,
    amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    reason       TEXT NOT NULL,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by   UUID REFERENCES staff(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_entries_tenant ON shift_entries (tenant_id);
CREATE INDEX IF NOT EXISTS idx_shift_entries_shift  ON shift_entries (shift_id, entry_type);

CREATE TABLE IF NOT EXISTS orders (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id         UUID REFERENCES branches(id) ON DELETE SET NULL,
    shift_id          UUID REFERENCES shifts(id) ON DELETE SET NULL,
    customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
    customer_name     TEXT NOT NULL,
    order_number      BIGINT NOT NULL,                  -- per-tenant sequential
    status            order_status NOT NULL DEFAULT 'measurements_taken',
    payment_method    payment_method NOT NULL DEFAULT 'cash',
    total_amount      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    paid_amount       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    remaining_amount  NUMERIC(14,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
    tax_rate          NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
    tax_amount        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    discount_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    order_date        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivery_date     TIMESTAMPTZ NOT NULL,
    qr_code           TEXT,
    images            JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes             TEXT,
    created_by        UUID REFERENCES staff(id) ON DELETE SET NULL,
    is_test           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_tenant_order_number ON orders (tenant_id, order_number);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status    ON orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_date      ON orders (tenant_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer         ON orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_branch           ON orders (branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_shift            ON orders (shift_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_date    ON orders (tenant_id, delivery_date);

CREATE TABLE IF NOT EXISTS order_items (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id             UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    type                 order_item_type NOT NULL,
    status               order_status,           -- null for ready_made
    -- ready-made ref
    item_id              UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
    variant_id           UUID REFERENCES inventory_variants(id) ON DELETE SET NULL,
    name                 TEXT,
    image                TEXT,
    -- custom tailoring fields
    garment_type         TEXT,
    fabric               TEXT,
    fabric_id            UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
    quantity             NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
    selected_unit        inventory_unit,
    consumed_meters      NUMERIC(14,4),
    price                NUMERIC(14,2) NOT NULL CHECK (price >= 0),
    -- customization
    closure_type         closure_type,
    closure_visibility   closure_visibility,
    collar_type          TEXT,
    cuff_type            TEXT,
    pocket_type          TEXT,
    chest_style          TEXT,
    collar_padding       collar_padding,
    additions            TEXT,
    embroidery           TEXT,
    measurements         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_tenant ON order_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order  ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_item   ON order_items (item_id);
CREATE INDEX IF NOT EXISTS idx_order_items_fabric ON order_items (fabric_id);

CREATE TABLE IF NOT EXISTS order_history (
    id               BIGSERIAL PRIMARY KEY,
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status           order_status NOT NULL,
    notes            TEXT,
    updated_by_staff UUID REFERENCES staff(id) ON DELETE SET NULL,
    updated_by_uid   TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_by_name  TEXT,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_history_tenant ON order_history (tenant_id);
CREATE INDEX IF NOT EXISTS idx_order_history_order  ON order_history (order_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id        UUID REFERENCES orders(id) ON DELETE SET NULL,
    invoice_id      UUID,
    shift_id        UUID REFERENCES shifts(id) ON DELETE SET NULL,
    amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    method          payment_method NOT NULL,
    reference       TEXT,
    received_by     UUID REFERENCES staff(id) ON DELETE SET NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_payments_tenant  ON payments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_order   ON payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_shift   ON payments (shift_id);
CREATE INDEX IF NOT EXISTS idx_payments_date    ON payments (tenant_id, received_at DESC);

CREATE TABLE IF NOT EXISTS tax_invoices (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id         UUID REFERENCES orders(id) ON DELETE SET NULL,
    invoice_number   TEXT NOT NULL,
    issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status           invoice_status NOT NULL DEFAULT 'issued',
    customer_id      UUID REFERENCES customers(id) ON DELETE SET NULL,
    customer_name    TEXT,
    subtotal         NUMERIC(14,2) NOT NULL,
    tax_rate         NUMERIC(6,4) NOT NULL DEFAULT 0,
    tax_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_amount     NUMERIC(14,2) NOT NULL,
    paid_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    qr_payload       TEXT,
    vat_number       TEXT,
    pdf_url          TEXT,
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_invoices_tenant_number ON tax_invoices (tenant_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_tenant              ON tax_invoices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_order               ON tax_invoices (order_id);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_status              ON tax_invoices (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_issued              ON tax_invoices (tenant_id, issued_at DESC);

DO $$ BEGIN
    ALTER TABLE payments
        ADD CONSTRAINT fk_payments_invoice
        FOREIGN KEY (invoice_id) REFERENCES tax_invoices(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS sales_returns (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_id       UUID NOT NULL REFERENCES tax_invoices(id) ON DELETE RESTRICT,
    order_id         UUID REFERENCES orders(id) ON DELETE SET NULL,
    return_number    TEXT NOT NULL,
    status           sales_return_status NOT NULL DEFAULT 'pending',
    reason           TEXT,
    total_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
    refunded_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
    refund_method    payment_method,
    processed_by     UUID REFERENCES staff(id) ON DELETE SET NULL,
    returned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_returns_tenant_number ON sales_returns (tenant_id, return_number);
CREATE INDEX IF NOT EXISTS idx_sales_returns_tenant              ON sales_returns (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_invoice             ON sales_returns (invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_status              ON sales_returns (tenant_id, status);

CREATE TABLE IF NOT EXISTS sales_return_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    return_id      UUID NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
    order_item_id  UUID REFERENCES order_items(id) ON DELETE SET NULL,
    item_id        UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
    name           TEXT NOT NULL,
    quantity       NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
    unit_price     NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    total          NUMERIC(14,2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_return_items_tenant ON sales_return_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_return_items_return ON sales_return_items (return_id);

CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    message     TEXT NOT NULL,
    type        notification_type NOT NULL,
    status      notification_status NOT NULL DEFAULT 'unread',
    target_staff UUID REFERENCES staff(id) ON DELETE CASCADE,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_test     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant         ON notifications (tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_status  ON notifications (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_target_staff   ON notifications (target_staff);
CREATE INDEX IF NOT EXISTS idx_notifications_created        ON notifications (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS employee_activity_logs (
    id             BIGSERIAL PRIMARY KEY,
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    staff_id       UUID REFERENCES staff(id) ON DELETE SET NULL,
    staff_name     TEXT,
    branch_id      UUID REFERENCES branches(id) ON DELETE SET NULL,
    branch_name    TEXT,
    action         TEXT NOT NULL,
    details        TEXT,
    previous_value JSONB,
    new_value      JSONB,
    ip_address     INET,
    user_agent     TEXT,
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emp_logs_tenant_time ON employee_activity_logs (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_emp_logs_staff       ON employee_activity_logs (staff_id);
CREATE INDEX IF NOT EXISTS idx_emp_logs_action      ON employee_activity_logs (tenant_id, action);

CREATE TABLE IF NOT EXISTS audit_logs (
    id                  BIGSERIAL PRIMARY KEY,
    tenant_id           UUID REFERENCES tenants(id) ON DELETE CASCADE,
    target_tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE,
    action              TEXT NOT NULL,
    performed_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
    performed_by_email  CITEXT,
    details             TEXT,
    type                audit_log_type NOT NULL DEFAULT 'system',
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs (target_tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_type   ON audit_logs (type);

CREATE TABLE IF NOT EXISTS security_logs (
    id           BIGSERIAL PRIMARY KEY,
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    staff_id     UUID REFERENCES staff(id) ON DELETE SET NULL,
    uid          TEXT REFERENCES users(id) ON DELETE SET NULL,
    action       TEXT NOT NULL,
    permission   TEXT,
    module       TEXT,
    ip_address   INET,
    user_agent   TEXT,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_logs_tenant ON security_logs (tenant_id, occurred_at DESC);

-- =============================================================================
-- updated_at trigger: keep updated_at fresh on row modification
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

-- Scoped to exactly the tables this migration owns (unlike the original
-- file's unrestricted "every public table with an updated_at column" scan,
-- which would also match tables created by later migrations and try to
-- recreate their own already-existing triggers). Each iteration is wrapped
-- so one already-existing trigger doesn't abort the rest of the loop.
DO $$
DECLARE
    tbl TEXT;
    base_tables TEXT[] := ARRAY[
        'users', 'plans', 'tenants', 'saas_users', 'saas_settings', 'tailor_requests',
        'branches', 'roles', 'staff', 'user_permission_overrides', 'customers', 'suppliers',
        'inventory_items', 'inventory_variants', 'branch_inventory', 'stock_transfers',
        'purchase_orders', 'shifts', 'orders', 'tax_invoices'
    ];
BEGIN
    FOR tbl IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'updated_at'
        WHERE c.relkind = 'r' AND n.nspname = 'public' AND NOT a.attisdropped
          AND c.relname = ANY(base_tables)
    LOOP
        BEGIN
            EXECUTE format(
                'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
                tbl, tbl
            );
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END LOOP;
END$$;

-- =============================================================================
-- Row Level Security — enable, force, and policy per tenant-scoped table
-- =============================================================================

ALTER TABLE users                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_settings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_security_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tailor_requests             ENABLE ROW LEVEL SECURITY;

-- Named policies below are guarded (skip-if-exists) rather than
-- DROP+CREATE, so any already-live hand-patched version (see
-- scripts/legacy-oneoff/fix-rls.sql, tracked separately in
-- 20260917080000_track_remaining_rls_patches.sql) is left untouched.
-- These bodies are only ever used on a genuinely fresh database.

DO $$ BEGIN
  CREATE POLICY users_self_read ON users
      FOR SELECT USING (app_is_super_admin() OR id = current_setting('app.current_uid', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY users_self_write ON users
      FOR UPDATE USING (app_is_super_admin() OR id = current_setting('app.current_uid', true))
      WITH CHECK (app_is_super_admin() OR id = current_setting('app.current_uid', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY users_super_admin_write ON users
      FOR INSERT WITH CHECK (app_is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY users_super_admin_delete ON users
      FOR DELETE USING (app_is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY plans_public_read ON plans
      FOR SELECT USING (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY plans_super_admin_write ON plans
      FOR ALL USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tenants_read ON tenants
      FOR SELECT USING (
          app_is_super_admin()
          OR id = app_current_tenant_id()
          OR owner_uid = current_setting('app.current_uid', true)
      );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY tenants_super_admin_write ON tenants
      FOR ALL USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY tenants_owner_update ON tenants
      FOR UPDATE USING (owner_uid = current_setting('app.current_uid', true))
      WITH CHECK (owner_uid = current_setting('app.current_uid', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY saas_users_super_admin_all ON saas_users
      FOR ALL USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY saas_settings_read_any ON saas_settings
      FOR SELECT USING (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY saas_settings_super_admin_write ON saas_settings
      FOR ALL USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY saas_security_logs_super_admin_read ON saas_security_logs
      FOR SELECT USING (app_is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY saas_security_logs_insert ON saas_security_logs
      FOR INSERT WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tailor_requests_self ON tailor_requests
      FOR SELECT USING (
          app_is_super_admin() OR uid = current_setting('app.current_uid', true)
      );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY tailor_requests_create ON tailor_requests
      FOR INSERT WITH CHECK (uid = current_setting('app.current_uid', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY tailor_requests_update ON tailor_requests
      FOR UPDATE USING (
          app_is_super_admin() OR uid = current_setting('app.current_uid', true)
      )
      WITH CHECK (
          app_is_super_admin() OR uid = current_setting('app.current_uid', true)
      );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY tailor_requests_delete ON tailor_requests
      FOR DELETE USING (app_is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- Tenant-scoped tables: apply the same symmetric policy shape everywhere.
-- No known drift on any of these 29 tables' generated policies -- guarded
-- purely so replaying this migration is always safe.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
    t TEXT;
    tenant_tables TEXT[] := ARRAY[
        'branches',
        'roles',
        'staff',
        'user_permission_overrides',
        'customers',
        'suppliers',
        'inventory_items',
        'inventory_variants',
        'branch_inventory',
        'stock_transfers',
        'stock_transfer_items',
        'stock_ledger',
        'inventory_reconciliations',
        'purchase_orders',
        'purchase_order_items',
        'purchase_returns',
        'purchase_return_items',
        'shifts',
        'shift_entries',
        'orders',
        'order_items',
        'order_history',
        'payments',
        'tax_invoices',
        'sales_returns',
        'sales_return_items',
        'notifications',
        'employee_activity_logs',
        'audit_logs',
        'security_logs'
    ];
BEGIN
    FOREACH t IN ARRAY tenant_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);

        BEGIN
            EXECUTE format($p$
                CREATE POLICY %I_tenant_read ON %I
                    FOR SELECT USING (
                        app_is_super_admin() OR tenant_id = app_current_tenant_id()
                    );
            $p$, t, t);
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;

        BEGIN
            EXECUTE format($p$
                CREATE POLICY %I_tenant_insert ON %I
                    FOR INSERT WITH CHECK (
                        app_is_super_admin() OR tenant_id = app_current_tenant_id()
                    );
            $p$, t, t);
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;

        BEGIN
            EXECUTE format($p$
                CREATE POLICY %I_tenant_update ON %I
                    FOR UPDATE USING (
                        app_is_super_admin() OR tenant_id = app_current_tenant_id()
                    )
                    WITH CHECK (
                        app_is_super_admin() OR tenant_id = app_current_tenant_id()
                    );
            $p$, t, t);
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;

        BEGIN
            EXECUTE format($p$
                CREATE POLICY %I_tenant_delete ON %I
                    FOR DELETE USING (
                        app_is_super_admin() OR tenant_id = app_current_tenant_id()
                    );
            $p$, t, t);
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END LOOP;
END$$;

-- -----------------------------------------------------------------------------
-- Immutability overrides for audit-style tables: no UPDATE, no DELETE at all.
-- DROP POLICY IF EXISTS is already idempotent -- unchanged from the original.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS stock_ledger_tenant_update               ON stock_ledger;
DROP POLICY IF EXISTS stock_ledger_tenant_delete               ON stock_ledger;
DROP POLICY IF EXISTS employee_activity_logs_tenant_update     ON employee_activity_logs;
DROP POLICY IF EXISTS employee_activity_logs_tenant_delete     ON employee_activity_logs;
DROP POLICY IF EXISTS audit_logs_tenant_update                 ON audit_logs;
DROP POLICY IF EXISTS audit_logs_tenant_delete                 ON audit_logs;
DROP POLICY IF EXISTS security_logs_tenant_update              ON security_logs;
DROP POLICY IF EXISTS security_logs_tenant_delete              ON security_logs;
DROP POLICY IF EXISTS order_history_tenant_update              ON order_history;
DROP POLICY IF EXISTS order_history_tenant_delete              ON order_history;
