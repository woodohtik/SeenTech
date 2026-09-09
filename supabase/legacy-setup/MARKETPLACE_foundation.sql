-- =============================================================================
--  سِين — أساس الماركت بليس (Bounded Context منفصل) — غير كاسر (جداول جديدة فقط)
--  سياقان: (أ) ماركت بليس B2C: مشترٍ (مستهلك) ↔ محل.  (ب) ماركت بليس الموردين: مورّد ↔ محل.
--  لا يلمس جداول المحل القائمة. يعيد استخدام نمط الـAuth نفسه:
--  الفاعل يُصادَق عبر Firebase، والـRLS تستند إلى app_current_uid() (= JWT sub).
--  يفترض وجود دوال المرحلة 1/الأساس: app_current_uid(), app_current_tenant_id(), app_is_super_admin().
-- =============================================================================

-- ENUMs السياق -------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE listing_status        AS ENUM ('draft','published','paused','archived');
  CREATE TYPE mp_order_status       AS ENUM ('pending','confirmed','preparing','shipped','delivered','cancelled','refunded');
  CREATE TYPE supplier_order_status AS ENUM ('rfq','quoted','accepted','fulfilled','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================== (أ) B2C =====================================

-- 1) المشتري (مستهلك) — فاعل مستقل عابر للمحلات -----------------------------------
CREATE TABLE IF NOT EXISTS buyers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid         text UNIQUE NOT NULL,                 -- Firebase uid (= JWT sub)
  name        text,
  phone       text,
  email       citext,
  default_address jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2) الكتالوج العام — منتجات المحل المعروضة للاكتشاف -----------------------------
CREATE TABLE IF NOT EXISTS listings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vertical_key   text,                              -- يرث نشاط المحل
  title          text NOT NULL,
  description    text,
  price          numeric(14,2) NOT NULL CHECK (price >= 0),
  currency       text NOT NULL DEFAULT 'SAR',
  images         jsonb NOT NULL DEFAULT '[]'::jsonb,
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb, -- خصائص حسب النشاط (مرن)
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL, -- ربط اختياري بالمخزون
  status         listing_status NOT NULL DEFAULT 'draft',
  is_custom_order boolean NOT NULL DEFAULT false,    -- منتج تفصيل بطلب أم جاهز
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_listings_published ON listings (status, vertical_key) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_listings_tenant    ON listings (tenant_id);

-- 3) سلة المشتري -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id   uuid NOT NULL REFERENCES buyers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_id)
);
CREATE TABLE IF NOT EXISTS cart_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id    uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  quantity   numeric(14,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  options    jsonb NOT NULL DEFAULT '{}'::jsonb,
  added_at   timestamptz NOT NULL DEFAULT now()
);

-- 4) طلبات الماركت بليس (مشترٍ ↔ محل) --------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id     uuid NOT NULL REFERENCES buyers(id) ON DELETE SET NULL,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, -- المحل البائع
  status       mp_order_status NOT NULL DEFAULT 'pending',
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  currency     text NOT NULL DEFAULT 'SAR',
  ship_address jsonb,
  -- جسر اختياري لطلب التفصيل الداخلي عند قبول المحل للطلب
  linked_order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  placed_at    timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mp_orders_tenant ON marketplace_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_mp_orders_buyer  ON marketplace_orders (buyer_id);

CREATE TABLE IF NOT EXISTS marketplace_order_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mp_order_id uuid NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  listing_id  uuid REFERENCES listings(id) ON DELETE SET NULL,
  title       text NOT NULL,
  quantity    numeric(14,2) NOT NULL CHECK (quantity > 0),
  unit_price  numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  options     jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- =============================== (ب) الموردون ================================

-- 5) حساب المورّد — فاعل مستقل ----------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid         text UNIQUE NOT NULL,                 -- Firebase uid (= JWT sub)
  company_name text NOT NULL,
  contact_person text,
  phone       text,
  email       citext,
  tax_number  text,
  categories  jsonb NOT NULL DEFAULT '[]'::jsonb,   -- فئات يورّدها (fabric, wood…)
  is_verified boolean NOT NULL DEFAULT false,       -- توثيق من سين
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 6) كتالوج المورّد --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_listings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES supplier_accounts(id) ON DELETE CASCADE,
  title       text NOT NULL,
  category_key text,
  unit        text,                                  -- meter/piece/box…
  price       numeric(14,2) NOT NULL CHECK (price >= 0),
  moq         numeric(14,2) NOT NULL DEFAULT 1,       -- أدنى كمية طلب
  images      jsonb NOT NULL DEFAULT '[]'::jsonb,
  attributes  jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      listing_status NOT NULL DEFAULT 'draft',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_listings_pub ON supplier_listings (status, category_key) WHERE status = 'published';

-- 7) طلب توريد (محل ↔ مورّد) — RFQ → عرض → قبول → توريد --------------------------
CREATE TABLE IF NOT EXISTS supplier_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,   -- المحل المشتري
  supplier_id  uuid NOT NULL REFERENCES supplier_accounts(id) ON DELETE SET NULL,
  status       supplier_order_status NOT NULL DEFAULT 'rfq',
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  currency     text NOT NULL DEFAULT 'SAR',
  notes        text,
  -- جسر اختياري لأمر الشراء الداخلي عند الإتمام
  linked_purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_tenant   ON supplier_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_supplier ON supplier_orders (supplier_id, status);

CREATE TABLE IF NOT EXISTS supplier_order_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_order_id  uuid NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  supplier_listing_id uuid REFERENCES supplier_listings(id) ON DELETE SET NULL,
  title              text NOT NULL,
  quantity           numeric(14,2) NOT NULL CHECK (quantity > 0),
  unit_price         numeric(14,2) NOT NULL DEFAULT 0
);

-- =============================== RLS =========================================
ALTER TABLE buyers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE carts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_orders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_listings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_order_items  ENABLE ROW LEVEL SECURITY;

-- المشتري يرى/يدير صفّه فقط
DROP POLICY IF EXISTS buyers_self ON buyers;
CREATE POLICY buyers_self ON buyers FOR ALL TO authenticated
  USING (uid = app_current_uid() OR app_is_super_admin())
  WITH CHECK (uid = app_current_uid() OR app_is_super_admin());

-- الكتالوج: المنشور مقروء للجميع المصادَقين؛ المحل يدير كتالوجه
DROP POLICY IF EXISTS listings_public_read ON listings;
CREATE POLICY listings_public_read ON listings FOR SELECT TO authenticated
  USING (status = 'published' OR tenant_id = app_current_tenant_id() OR app_is_super_admin());
DROP POLICY IF EXISTS listings_tenant_write ON listings;
CREATE POLICY listings_tenant_write ON listings FOR ALL TO authenticated
  USING (tenant_id = app_current_tenant_id() OR app_is_super_admin())
  WITH CHECK (tenant_id = app_current_tenant_id() OR app_is_super_admin());

-- السلة: ملك المشتري
DROP POLICY IF EXISTS carts_own ON carts;
CREATE POLICY carts_own ON carts FOR ALL TO authenticated
  USING (buyer_id IN (SELECT id FROM buyers WHERE uid = app_current_uid()))
  WITH CHECK (buyer_id IN (SELECT id FROM buyers WHERE uid = app_current_uid()));
DROP POLICY IF EXISTS cart_items_own ON cart_items;
CREATE POLICY cart_items_own ON cart_items FOR ALL TO authenticated
  USING (cart_id IN (SELECT c.id FROM carts c JOIN buyers b ON b.id=c.buyer_id WHERE b.uid = app_current_uid()))
  WITH CHECK (cart_id IN (SELECT c.id FROM carts c JOIN buyers b ON b.id=c.buyer_id WHERE b.uid = app_current_uid()));

-- طلبات الماركت بليس: يراها المشتري صاحبها أو المحل البائع
DROP POLICY IF EXISTS mp_orders_party ON marketplace_orders;
CREATE POLICY mp_orders_party ON marketplace_orders FOR SELECT TO authenticated
  USING (tenant_id = app_current_tenant_id()
         OR buyer_id IN (SELECT id FROM buyers WHERE uid = app_current_uid())
         OR app_is_super_admin());
DROP POLICY IF EXISTS mp_items_party ON marketplace_order_items;
CREATE POLICY mp_items_party ON marketplace_order_items FOR SELECT TO authenticated
  USING (mp_order_id IN (SELECT id FROM marketplace_orders
          WHERE tenant_id = app_current_tenant_id()
             OR buyer_id IN (SELECT id FROM buyers WHERE uid = app_current_uid())
             OR app_is_super_admin()));

-- المورّد يدير حسابه وكتالوجه؛ الكتالوج المنشور مقروء للمحلات
DROP POLICY IF EXISTS supplier_self ON supplier_accounts;
CREATE POLICY supplier_self ON supplier_accounts FOR ALL TO authenticated
  USING (uid = app_current_uid() OR app_is_super_admin())
  WITH CHECK (uid = app_current_uid() OR app_is_super_admin());
DROP POLICY IF EXISTS supplier_listings_read ON supplier_listings;
CREATE POLICY supplier_listings_read ON supplier_listings FOR SELECT TO authenticated
  USING (status = 'published'
         OR supplier_id IN (SELECT id FROM supplier_accounts WHERE uid = app_current_uid())
         OR app_is_super_admin());
DROP POLICY IF EXISTS supplier_listings_write ON supplier_listings;
CREATE POLICY supplier_listings_write ON supplier_listings FOR ALL TO authenticated
  USING (supplier_id IN (SELECT id FROM supplier_accounts WHERE uid = app_current_uid()) OR app_is_super_admin())
  WITH CHECK (supplier_id IN (SELECT id FROM supplier_accounts WHERE uid = app_current_uid()) OR app_is_super_admin());

-- طلبات التوريد: يراها المحل الطالب أو المورّد الطرف
DROP POLICY IF EXISTS supplier_orders_party ON supplier_orders;
CREATE POLICY supplier_orders_party ON supplier_orders FOR SELECT TO authenticated
  USING (tenant_id = app_current_tenant_id()
         OR supplier_id IN (SELECT id FROM supplier_accounts WHERE uid = app_current_uid())
         OR app_is_super_admin());
DROP POLICY IF EXISTS supplier_order_items_party ON supplier_order_items;
CREATE POLICY supplier_order_items_party ON supplier_order_items FOR SELECT TO authenticated
  USING (supplier_order_id IN (SELECT id FROM supplier_orders
          WHERE tenant_id = app_current_tenant_id()
             OR supplier_id IN (SELECT id FROM supplier_accounts WHERE uid = app_current_uid())
             OR app_is_super_admin()));

-- ملاحظات:
--  • عمليات الكتابة الحسّاسة (إنشاء طلب/تأكيد) تُمرّر عبر دوال SECURITY DEFINER أو السيرفر،
--    على غرار نمط المنتج الحالي، لضبط الانتقالات والمبالغ. تُضاف في طبقة الخدمة لاحقاً.
--  • الجسور linked_order_id / linked_purchase_order_id تربط الماركت بليس بنواة المحل
--    دون دمج النموذجين — يبقى كل سياق مستقلاً.
