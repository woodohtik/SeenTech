-- =============================================================================
--  سِين — هجرة التمدّد (المرحلة 1) — غير كاسرة
--  تزرع نقاط التوسّع (النشاط/الموديولات/التخصيص المرن/مراحل العمل) دون تغيير
--  أي سلوك حالي. كل الافتراضات تحافظ على «الخياطة الرجالية» حرفياً.
--  آمنة للتشغيل على الإنتاج (كلها IF NOT EXISTS / DEFAULT).
-- =============================================================================

-- 1) جدول الأنشطة المرجعي ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS verticals (
  key        text PRIMARY KEY,
  name_ar    text NOT NULL,
  name_en    text,
  is_active  boolean NOT NULL DEFAULT true,
  sort       int NOT NULL DEFAULT 0
);
INSERT INTO verticals(key, name_ar, name_en, sort) VALUES
  ('mens_tailoring',   'خياطة رجالية', 'Men''s Tailoring', 1),
  ('womens_tailoring', 'خياطة نسائية', 'Women''s Tailoring', 2),
  ('furniture',        'أثاث وتنجيد',  'Furniture & Upholstery', 3)
ON CONFLICT (key) DO NOTHING;

-- 2) نشاط المستأجر + الموديولات المفعّلة ------------------------------------------
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vertical text NOT NULL DEFAULT 'mens_tailoring'
  REFERENCES verticals(key) ON UPDATE CASCADE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS enabled_modules jsonb NOT NULL
  DEFAULT '["pos","orders","inventory","invoicing","customers"]'::jsonb;
-- الموديولات المستقبلية تُضاف للمصفوفة لكل محل: "marketplace_b2c","supplier_marketplace"...

-- 3) تخصيص مرن (بدل أعمدة ثابتة لكل نشاط) ----------------------------------------
ALTER TABLE order_items     ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
-- قاعدة: أي تخصيص خاص بنشاط جديد يُخزّن هنا، لا كعمود جديد.
-- أعمدة الثوب الحالية (closure_type, collar_type...) تبقى للتوافق العكسي.

-- 4) مراحل العمل لكل نشاط (config بدل enum ثابت) ---------------------------------
CREATE TABLE IF NOT EXISTS vertical_workflow_stages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_key  text NOT NULL REFERENCES verticals(key) ON DELETE CASCADE,
  stage_key     text NOT NULL,
  label_ar      text NOT NULL,
  sort          int  NOT NULL DEFAULT 0,
  is_terminal   boolean NOT NULL DEFAULT false,
  UNIQUE (vertical_key, stage_key)
);
-- بذرة مطابقة لـ order_status الحالي (حتى تقرأ الواجهة المراحل من هنا بلا تغيير سلوك)
INSERT INTO vertical_workflow_stages(vertical_key, stage_key, label_ar, sort, is_terminal) VALUES
  ('mens_tailoring','measurements_taken','تم أخذ المقاسات',1,false),
  ('mens_tailoring','cutting','قص',2,false),
  ('mens_tailoring','sewing','خياطة',3,false),
  ('mens_tailoring','embroidery','تطريز',4,false),
  ('mens_tailoring','ironing_packaging','كي وتغليف',5,false),
  ('mens_tailoring','ready','جاهز',6,false),
  ('mens_tailoring','partial_delivered','تسليم جزئي',7,false),
  ('mens_tailoring','delivered','تم التسليم',8,true),
  ('mens_tailoring','cancelled','ملغي',9,true)
ON CONFLICT (vertical_key, stage_key) DO NOTHING;

-- 5) (اختياري لاحقاً) schema حقول التخصيص لكل نشاط — يُملأ عند إطلاق نشاط جديد ----
CREATE TABLE IF NOT EXISTS vertical_field_schemas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_key  text NOT NULL REFERENCES verticals(key) ON DELETE CASCADE,
  field_key     text NOT NULL,
  label_ar      text NOT NULL,
  field_type    text NOT NULL DEFAULT 'text',  -- text|number|select|bool
  options       jsonb,                          -- للـ select
  applies_to    text NOT NULL DEFAULT 'order_item', -- order_item|inventory_item|customer
  sort          int NOT NULL DEFAULT 0,
  UNIQUE (vertical_key, applies_to, field_key)
);

-- 6) RLS للجداول المرجعية (قراءة عامة للمصادَق، كتابة للأدمن) ---------------------
ALTER TABLE verticals               ENABLE ROW LEVEL SECURITY;
ALTER TABLE vertical_workflow_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE vertical_field_schemas  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS verticals_read ON verticals;
CREATE POLICY verticals_read ON verticals FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS vws_read ON vertical_workflow_stages;
CREATE POLICY vws_read ON vertical_workflow_stages FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS vfs_read ON vertical_field_schemas;
CREATE POLICY vfs_read ON vertical_field_schemas FOR SELECT TO authenticated USING (true);
-- الكتابة على هذه الجداول المرجعية تتم بدور super_admin عبر السيرفر (service_role) فقط.

-- ملاحظة: لا تغيير على enum order_status / inventory_category في هذه المرحلة (غير كاسر).
-- تحويلهما إلى نصّ مدفوع-بالـconfig يتم في «المرحلة 2» عند إطلاق أول نشاط جديد.
