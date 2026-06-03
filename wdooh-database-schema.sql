-- =============================================================================
-- Wdooh SaaS POS — PostgreSQL Schema Migration
-- Multi-tenant database for a tailoring / fabric retail platform.
-- =============================================================================
-- Design constraints:
--   * Every operational table carries tenant_id UUID referencing tenants(id).
--   * users.id is TEXT to hold the Firebase UID directly (no remapping).
--   * Measurements and other variable-shape data use JSONB.
--   * All fixed-domain states are ENUM types.
--   * All date/time fields use TIMESTAMP WITH TIME ZONE.
--   * Row Level Security is enabled for every tenant-scoped table using
--     current_setting('app.current_tenant_id', true)::uuid — the application
--     layer sets this per request after resolving the Firebase UID.
--   * Indexes are added on every tenant_id FK, foreign keys, and the hot
--     lookup columns (phone, barcode, sku, invoice_number, order_number, etc.).
-- =============================================================================

-- Extensions ------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";    -- case-insensitive email/phone

BEGIN;

-- =============================================================================
-- Helper: tenant context resolver used by every RLS policy.
-- The application is expected to run:
--     SELECT set_config('app.current_tenant_id', '<uuid>', true);
--     SELECT set_config('app.is_super_admin',    'true'|'false', true);
-- at the start of every transaction, after verifying the Firebase JWT.
-- =============================================================================

CREATE OR REPLACE FUNCTION app_current_tenant_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
    SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT COALESCE(NULLIF(current_setting('app.is_super_admin', true), ''), 'false')::boolean
$$;

-- =============================================================================
-- ENUM types
-- =============================================================================

CREATE TYPE tenant_status          AS ENUM ('active', 'inactive', 'pending');
CREATE TYPE inventory_strategy     AS ENUM ('centralized', 'decentralized');
CREATE TYPE layout_mode            AS ENUM ('sidebar', 'grid');

CREATE TYPE saas_user_role         AS ENUM ('super_admin', 'support_tech', 'billing_admin');

CREATE TYPE user_role              AS ENUM (
    'super_admin', 'support_tech', 'billing_admin',
    'owner', 'admin', 'manager', 'cashier', 'tailor',
    'accountant', 'branch_manager', 'warehouse_manager'
);

CREATE TYPE staff_status           AS ENUM ('active', 'inactive');
CREATE TYPE branch_type            AS ENUM ('warehouse', 'store');

CREATE TYPE inventory_category     AS ENUM (
    'fabric', 'thread', 'button', 'lining',
    'accessories', 'ready_made', 'other'
);

CREATE TYPE inventory_unit         AS ENUM (
    'meter', 'yard', 'roll', 'bolt', 'piece', 'spool', 'box'
);

CREATE TYPE inventory_base_unit    AS ENUM ('meter', 'piece');

CREATE TYPE payment_method         AS ENUM (
    'cash', 'network', 'bank_transfer', 'cash_on_delivery', 'partial'
);

CREATE TYPE order_status           AS ENUM (
    'measurements_taken', 'cutting', 'sewing', 'embroidery',
    'ironing_packaging', 'ready', 'partial_delivered',
    'delivered', 'cancelled'
);

CREATE TYPE order_item_type        AS ENUM ('custom', 'ready_made');
CREATE TYPE closure_type           AS ENUM ('zipper', 'buttons');
CREATE TYPE closure_visibility     AS ENUM ('hidden', 'visible');
CREATE TYPE collar_padding         AS ENUM ('hard', 'soft');

CREATE TYPE purchase_order_status  AS ENUM ('draft', 'sent', 'received', 'returned');

CREATE TYPE transfer_status        AS ENUM (
    'draft', 'pending', 'in_transit', 'completed', 'rejected', 'cancelled'
);

CREATE TYPE stock_movement_type    AS ENUM (
    'addition', 'deduction', 'transfer_in', 'transfer_out',
    'reconciliation', 'adjustment', 'sale'
);

CREATE TYPE shift_status           AS ENUM ('open', 'closed');
CREATE TYPE shift_entry_type       AS ENUM ('payout', 'deposit');

CREATE TYPE tailor_request_status  AS ENUM ('pending', 'approved', 'rejected');

CREATE TYPE notification_type      AS ENUM ('inventory', 'order', 'system', 'alert');
CREATE TYPE notification_status    AS ENUM ('unread', 'read');

CREATE TYPE invoice_status         AS ENUM (
    'draft', 'issued', 'paid', 'partially_paid', 'refunded', 'cancelled'
);

CREATE TYPE sales_return_status    AS ENUM ('pending', 'approved', 'rejected', 'completed');

CREATE TYPE audit_log_type         AS ENUM ('deletion', 'security', 'system');

-- =============================================================================
-- Global (platform-wide) tables — NOT tenant-scoped
-- =============================================================================

-- ---- Users: Firebase UIDs as TEXT primary keys -----------------------------

CREATE TABLE users (
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

CREATE INDEX idx_users_email ON users (email);

-- ---- Subscription plans -----------------------------------------------------

CREATE TABLE plans (
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

-- ---- Tenants (the root of multi-tenancy) -----------------------------------

CREATE TABLE tenants (
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

CREATE INDEX idx_tenants_status     ON tenants (status);
CREATE INDEX idx_tenants_plan_id    ON tenants (plan_id);
CREATE INDEX idx_tenants_owner_uid  ON tenants (owner_uid);
CREATE INDEX idx_tenants_owner_email ON tenants (owner_email);

-- ---- SaaS platform users (Wdooh staff, not tenant staff) --------------------

CREATE TABLE saas_users (
    uid           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    email         CITEXT NOT NULL UNIQUE,
    role          saas_user_role NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    mfa_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_saas_users_role ON saas_users (role);

-- ---- SaaS-wide settings (branding, kill-switches) --------------------------

CREATE TABLE saas_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- SaaS security logs (cross-tenant) -------------------------------------

CREATE TABLE saas_security_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
    user_email  CITEXT,
    action      TEXT NOT NULL,
    details     TEXT,
    ip_address  INET,
    user_agent  TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_saas_security_logs_user     ON saas_security_logs (user_id);
CREATE INDEX idx_saas_security_logs_occurred ON saas_security_logs (occurred_at DESC);

-- ---- Tailor sign-up requests (pre-tenant) ----------------------------------

CREATE TABLE tailor_requests (
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

CREATE INDEX idx_tailor_requests_status ON tailor_requests (status);
CREATE INDEX idx_tailor_requests_uid    ON tailor_requests (uid);
CREATE INDEX idx_tailor_requests_email  ON tailor_requests (email);

-- =============================================================================
-- Tenant-scoped operational tables
-- =============================================================================

-- ---- Branches ---------------------------------------------------------------

CREATE TABLE branches (
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

CREATE INDEX idx_branches_tenant     ON branches (tenant_id);
CREATE INDEX idx_branches_type       ON branches (tenant_id, type);
CREATE UNIQUE INDEX uq_branches_one_main
    ON branches (tenant_id) WHERE is_main;

-- ---- Roles (RBAC) -----------------------------------------------------------

CREATE TABLE roles (
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

CREATE UNIQUE INDEX uq_roles_tenant_key ON roles (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), role_key);
CREATE INDEX idx_roles_tenant            ON roles (tenant_id);

-- ---- Staff ------------------------------------------------------------------

CREATE TABLE staff (
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

CREATE UNIQUE INDEX uq_staff_tenant_email ON staff (tenant_id, email);
CREATE INDEX idx_staff_tenant              ON staff (tenant_id);
CREATE INDEX idx_staff_tenant_status       ON staff (tenant_id, status);
CREATE INDEX idx_staff_branch              ON staff (branch_id);
CREATE INDEX idx_staff_uid                 ON staff (uid);
CREATE INDEX idx_staff_role_id             ON staff (role_id);

-- ---- User permission overrides (per-staff overrides on role permissions) ---

CREATE TABLE user_permission_overrides (
    staff_id     UUID PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    overrides    JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_perm_overrides_tenant ON user_permission_overrides (tenant_id);

-- ---- Customers --------------------------------------------------------------

CREATE TABLE customers (
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

CREATE INDEX idx_customers_tenant          ON customers (tenant_id);
CREATE INDEX idx_customers_tenant_phone    ON customers (tenant_id, phone);
CREATE INDEX idx_customers_tenant_name_trgm
    ON customers USING GIN (name gin_trgm_ops);
-- The GIN trigram index needs the pg_trgm extension; enable it if the
-- application intends to use name-search (free-text).
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---- Suppliers --------------------------------------------------------------

CREATE TABLE suppliers (
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

CREATE INDEX idx_suppliers_tenant      ON suppliers (tenant_id);
CREATE INDEX idx_suppliers_tenant_name ON suppliers (tenant_id, name);

-- ---- Inventory master catalog ----------------------------------------------

CREATE TABLE inventory_items (
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

CREATE UNIQUE INDEX uq_inventory_items_tenant_sku     ON inventory_items (tenant_id, sku);
CREATE UNIQUE INDEX uq_inventory_items_tenant_barcode ON inventory_items (tenant_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_inventory_items_tenant               ON inventory_items (tenant_id);
CREATE INDEX idx_inventory_items_category             ON inventory_items (tenant_id, category);
CREATE INDEX idx_inventory_items_supplier             ON inventory_items (supplier_id);

-- ---- Inventory variants (size / color SKUs) --------------------------------

CREATE TABLE inventory_variants (
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

CREATE UNIQUE INDEX uq_inventory_variants_tenant_sku ON inventory_variants (tenant_id, sku);
CREATE INDEX idx_inventory_variants_tenant            ON inventory_variants (tenant_id);
CREATE INDEX idx_inventory_variants_item              ON inventory_variants (item_id);

-- ---- Branch-level inventory (per-branch quantities) ------------------------

CREATE TABLE branch_inventory (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    item_id     UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    variant_id  UUID REFERENCES inventory_variants(id) ON DELETE CASCADE,
    quantity    NUMERIC(14,4) NOT NULL DEFAULT 0,
    reserved    NUMERIC(14,4) NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_branch_inventory_branch_item
    ON branch_inventory (branch_id, item_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX idx_branch_inventory_tenant ON branch_inventory (tenant_id);
CREATE INDEX idx_branch_inventory_branch ON branch_inventory (branch_id);
CREATE INDEX idx_branch_inventory_item   ON branch_inventory (item_id);

-- ---- Stock transfers (between branches) ------------------------------------

CREATE TABLE stock_transfers (
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

CREATE INDEX idx_stock_transfers_tenant ON stock_transfers (tenant_id);
CREATE INDEX idx_stock_transfers_status ON stock_transfers (tenant_id, status);
CREATE INDEX idx_stock_transfers_from   ON stock_transfers (from_branch_id);
CREATE INDEX idx_stock_transfers_to     ON stock_transfers (to_branch_id);

CREATE TABLE stock_transfer_items (
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

CREATE INDEX idx_stock_transfer_items_tenant   ON stock_transfer_items (tenant_id);
CREATE INDEX idx_stock_transfer_items_transfer ON stock_transfer_items (transfer_id);
CREATE INDEX idx_stock_transfer_items_item     ON stock_transfer_items (item_id);

-- ---- Immutable stock movement ledger ---------------------------------------

CREATE TABLE stock_ledger (
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

CREATE INDEX idx_stock_ledger_tenant_time ON stock_ledger (tenant_id, created_at DESC);
CREATE INDEX idx_stock_ledger_item        ON stock_ledger (item_id, created_at DESC);
CREATE INDEX idx_stock_ledger_branch      ON stock_ledger (branch_id, created_at DESC);
CREATE INDEX idx_stock_ledger_reference   ON stock_ledger (reference_id);

-- ---- Inventory reconciliations ---------------------------------------------

CREATE TABLE inventory_reconciliations (
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

CREATE INDEX idx_inventory_reconciliations_tenant ON inventory_reconciliations (tenant_id);
CREATE INDEX idx_inventory_reconciliations_item   ON inventory_reconciliations (item_id);

-- ---- Purchase orders --------------------------------------------------------

CREATE TABLE purchase_orders (
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

CREATE UNIQUE INDEX uq_purchase_orders_tenant_po ON purchase_orders (tenant_id, po_number);
CREATE INDEX idx_purchase_orders_tenant          ON purchase_orders (tenant_id);
CREATE INDEX idx_purchase_orders_supplier        ON purchase_orders (supplier_id);
CREATE INDEX idx_purchase_orders_status          ON purchase_orders (tenant_id, status);
CREATE INDEX idx_purchase_orders_date            ON purchase_orders (tenant_id, order_date DESC);

CREATE TABLE purchase_order_items (
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

CREATE INDEX idx_po_items_tenant ON purchase_order_items (tenant_id);
CREATE INDEX idx_po_items_po     ON purchase_order_items (purchase_order_id);
CREATE INDEX idx_po_items_item   ON purchase_order_items (item_id);

-- ---- Purchase returns -------------------------------------------------------

CREATE TABLE purchase_returns (
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

CREATE UNIQUE INDEX uq_purchase_returns_tenant_num ON purchase_returns (tenant_id, return_number);
CREATE INDEX idx_purchase_returns_tenant           ON purchase_returns (tenant_id);
CREATE INDEX idx_purchase_returns_po               ON purchase_returns (purchase_order_id);
CREATE INDEX idx_purchase_returns_supplier         ON purchase_returns (supplier_id);

CREATE TABLE purchase_return_items (
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

CREATE INDEX idx_pr_items_tenant ON purchase_return_items (tenant_id);
CREATE INDEX idx_pr_items_return ON purchase_return_items (purchase_return_id);

-- ---- Shifts (POS cash drawer sessions) -------------------------------------

CREATE TABLE shifts (
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

CREATE INDEX idx_shifts_tenant         ON shifts (tenant_id);
CREATE INDEX idx_shifts_tenant_status  ON shifts (tenant_id, status);
CREATE INDEX idx_shifts_staff          ON shifts (staff_id);
CREATE INDEX idx_shifts_branch_status  ON shifts (branch_id, status);
CREATE INDEX idx_shifts_start          ON shifts (tenant_id, start_time DESC);

-- Per-shift payouts and deposits (one table, discriminated by entry_type).

CREATE TABLE shift_entries (
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

CREATE INDEX idx_shift_entries_tenant ON shift_entries (tenant_id);
CREATE INDEX idx_shift_entries_shift  ON shift_entries (shift_id, entry_type);

-- ---- Orders (tailoring / ready-made mixed) ---------------------------------

CREATE TABLE orders (
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

CREATE UNIQUE INDEX uq_orders_tenant_order_number ON orders (tenant_id, order_number);
CREATE INDEX idx_orders_tenant_status    ON orders (tenant_id, status);
CREATE INDEX idx_orders_tenant_date      ON orders (tenant_id, order_date DESC);
CREATE INDEX idx_orders_customer         ON orders (customer_id);
CREATE INDEX idx_orders_branch           ON orders (branch_id);
CREATE INDEX idx_orders_shift            ON orders (shift_id);
CREATE INDEX idx_orders_delivery_date    ON orders (tenant_id, delivery_date);

CREATE TABLE order_items (
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

CREATE INDEX idx_order_items_tenant ON order_items (tenant_id);
CREATE INDEX idx_order_items_order  ON order_items (order_id);
CREATE INDEX idx_order_items_item   ON order_items (item_id);
CREATE INDEX idx_order_items_fabric ON order_items (fabric_id);

CREATE TABLE order_history (
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

CREATE INDEX idx_order_history_tenant ON order_history (tenant_id);
CREATE INDEX idx_order_history_order  ON order_history (order_id, updated_at DESC);

-- ---- Payments (money movements against orders) -----------------------------

CREATE TABLE payments (
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

CREATE INDEX idx_payments_tenant  ON payments (tenant_id);
CREATE INDEX idx_payments_order   ON payments (order_id);
CREATE INDEX idx_payments_invoice ON payments (invoice_id);
CREATE INDEX idx_payments_shift   ON payments (shift_id);
CREATE INDEX idx_payments_date    ON payments (tenant_id, received_at DESC);

-- ---- Tax invoices (ZATCA-ready) --------------------------------------------

CREATE TABLE tax_invoices (
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

CREATE UNIQUE INDEX uq_tax_invoices_tenant_number ON tax_invoices (tenant_id, invoice_number);
CREATE INDEX idx_tax_invoices_tenant              ON tax_invoices (tenant_id);
CREATE INDEX idx_tax_invoices_order               ON tax_invoices (order_id);
CREATE INDEX idx_tax_invoices_status              ON tax_invoices (tenant_id, status);
CREATE INDEX idx_tax_invoices_issued              ON tax_invoices (tenant_id, issued_at DESC);

-- Post-hoc FK from payments.invoice_id -> tax_invoices.id
ALTER TABLE payments
    ADD CONSTRAINT fk_payments_invoice
    FOREIGN KEY (invoice_id) REFERENCES tax_invoices(id) ON DELETE SET NULL;

-- ---- Sales returns (refunds on issued invoices) ----------------------------

CREATE TABLE sales_returns (
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

CREATE UNIQUE INDEX uq_sales_returns_tenant_number ON sales_returns (tenant_id, return_number);
CREATE INDEX idx_sales_returns_tenant              ON sales_returns (tenant_id);
CREATE INDEX idx_sales_returns_invoice             ON sales_returns (invoice_id);
CREATE INDEX idx_sales_returns_status              ON sales_returns (tenant_id, status);

CREATE TABLE sales_return_items (
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

CREATE INDEX idx_sales_return_items_tenant ON sales_return_items (tenant_id);
CREATE INDEX idx_sales_return_items_return ON sales_return_items (return_id);

-- ---- Notifications ---------------------------------------------------------

CREATE TABLE notifications (
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

CREATE INDEX idx_notifications_tenant         ON notifications (tenant_id);
CREATE INDEX idx_notifications_tenant_status  ON notifications (tenant_id, status);
CREATE INDEX idx_notifications_target_staff   ON notifications (target_staff);
CREATE INDEX idx_notifications_created        ON notifications (tenant_id, created_at DESC);

-- ---- Employee activity logs -------------------------------------------------

CREATE TABLE employee_activity_logs (
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

CREATE INDEX idx_emp_logs_tenant_time ON employee_activity_logs (tenant_id, occurred_at DESC);
CREATE INDEX idx_emp_logs_staff       ON employee_activity_logs (staff_id);
CREATE INDEX idx_emp_logs_action      ON employee_activity_logs (tenant_id, action);

-- ---- Audit logs (tenant-scoped admin actions) ------------------------------

CREATE TABLE audit_logs (
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

CREATE INDEX idx_audit_logs_tenant ON audit_logs (tenant_id, occurred_at DESC);
CREATE INDEX idx_audit_logs_target ON audit_logs (target_tenant_id, occurred_at DESC);
CREATE INDEX idx_audit_logs_type   ON audit_logs (type);

-- ---- Security logs (unauthorized-access attempts, permission denials) ------

CREATE TABLE security_logs (
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

CREATE INDEX idx_security_logs_tenant ON security_logs (tenant_id, occurred_at DESC);

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

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'updated_at'
        WHERE c.relkind = 'r' AND n.nspname = 'public' AND NOT a.attisdropped
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            tbl, tbl
        );
    END LOOP;
END$$;

-- =============================================================================
-- Row Level Security — enable, force, and policy per tenant-scoped table
-- =============================================================================
-- Global convention:
--   * Every tenant-scoped table: tenant_id must equal app_current_tenant_id()
--   * Super admin bypasses via app_is_super_admin()
--   * On INSERT we also constrain tenant_id via WITH CHECK.
-- =============================================================================

-- Enable RLS on global tables where appropriate.
ALTER TABLE users                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_settings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas_security_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tailor_requests             ENABLE ROW LEVEL SECURITY;

-- Users: a user can see their own row; super admins see all.
CREATE POLICY users_self_read ON users
    FOR SELECT USING (app_is_super_admin() OR id = current_setting('app.current_uid', true));
CREATE POLICY users_self_write ON users
    FOR UPDATE USING (app_is_super_admin() OR id = current_setting('app.current_uid', true))
    WITH CHECK (app_is_super_admin() OR id = current_setting('app.current_uid', true));
CREATE POLICY users_super_admin_write ON users
    FOR INSERT WITH CHECK (app_is_super_admin());
CREATE POLICY users_super_admin_delete ON users
    FOR DELETE USING (app_is_super_admin());

-- Plans: public read, super admin write.
CREATE POLICY plans_public_read ON plans
    FOR SELECT USING (TRUE);
CREATE POLICY plans_super_admin_write ON plans
    FOR ALL USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());

-- Tenants: a user can read tenants they own or belong to; super admins see all.
CREATE POLICY tenants_read ON tenants
    FOR SELECT USING (
        app_is_super_admin()
        OR id = app_current_tenant_id()
        OR owner_uid = current_setting('app.current_uid', true)
    );
CREATE POLICY tenants_super_admin_write ON tenants
    FOR ALL USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());
CREATE POLICY tenants_owner_update ON tenants
    FOR UPDATE USING (owner_uid = current_setting('app.current_uid', true))
    WITH CHECK (owner_uid = current_setting('app.current_uid', true));

-- SaaS users: super admin only.
CREATE POLICY saas_users_super_admin_all ON saas_users
    FOR ALL USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());

-- SaaS settings: readable by authenticated users, writable by super admin.
CREATE POLICY saas_settings_read_any ON saas_settings
    FOR SELECT USING (TRUE);
CREATE POLICY saas_settings_super_admin_write ON saas_settings
    FOR ALL USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());

-- SaaS security logs: super admin read; insert-only by any authenticated session.
CREATE POLICY saas_security_logs_super_admin_read ON saas_security_logs
    FOR SELECT USING (app_is_super_admin());
CREATE POLICY saas_security_logs_insert ON saas_security_logs
    FOR INSERT WITH CHECK (TRUE);

-- Tailor requests: the requesting user sees their own; super admin sees all.
CREATE POLICY tailor_requests_self ON tailor_requests
    FOR SELECT USING (
        app_is_super_admin() OR uid = current_setting('app.current_uid', true)
    );
CREATE POLICY tailor_requests_create ON tailor_requests
    FOR INSERT WITH CHECK (uid = current_setting('app.current_uid', true));
CREATE POLICY tailor_requests_update ON tailor_requests
    FOR UPDATE USING (
        app_is_super_admin() OR uid = current_setting('app.current_uid', true)
    )
    WITH CHECK (
        app_is_super_admin() OR uid = current_setting('app.current_uid', true)
    );
CREATE POLICY tailor_requests_delete ON tailor_requests
    FOR DELETE USING (app_is_super_admin());

-- -----------------------------------------------------------------------------
-- Tenant-scoped tables: apply the same symmetric policy shape everywhere.
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

        EXECUTE format($p$
            CREATE POLICY %I_tenant_read ON %I
                FOR SELECT USING (
                    app_is_super_admin() OR tenant_id = app_current_tenant_id()
                );
        $p$, t, t);

        EXECUTE format($p$
            CREATE POLICY %I_tenant_insert ON %I
                FOR INSERT WITH CHECK (
                    app_is_super_admin() OR tenant_id = app_current_tenant_id()
                );
        $p$, t, t);

        EXECUTE format($p$
            CREATE POLICY %I_tenant_update ON %I
                FOR UPDATE USING (
                    app_is_super_admin() OR tenant_id = app_current_tenant_id()
                )
                WITH CHECK (
                    app_is_super_admin() OR tenant_id = app_current_tenant_id()
                );
        $p$, t, t);

        EXECUTE format($p$
            CREATE POLICY %I_tenant_delete ON %I
                FOR DELETE USING (
                    app_is_super_admin() OR tenant_id = app_current_tenant_id()
                );
        $p$, t, t);
    END LOOP;
END$$;

-- -----------------------------------------------------------------------------
-- Immutability overrides for audit-style tables: no UPDATE, no DELETE at all.
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

COMMIT;

-- =============================================================================
-- Usage notes (application layer):
--
--   -- At the start of each authenticated request, the API server runs:
--   BEGIN;
--   SELECT set_config('app.current_uid', '<firebase_uid>', true);
--   SELECT set_config('app.current_tenant_id', '<tenant_uuid>', true);
--   SELECT set_config('app.is_super_admin', 'false', true);
--   -- ... regular queries ...
--   COMMIT;
--
--   -- For SaaS super-admin requests skip the tenant_id and set is_super_admin
--   -- to 'true'. RLS will then permit cross-tenant reads.
-- =============================================================================
