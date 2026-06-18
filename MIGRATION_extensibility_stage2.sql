-- =============================================================================
--  سِين — هجرة التمدّد (المرحلة 2) — طبقة المجال مدفوعة بالـconfig — غير كاسرة
--  تشترط تطبيق المرحلة 1 أولاً (verticals / vertical_workflow_stages / vertical_field_schemas).
--  تضيف: مفاتيح نصّية تَخلُف الـenums (بدون حذفها)، وconfig فئات المخزون،
--  وبذور كاملة للنشاطين الجديدين: خياطة نسائية + أثاث وتنجيد.
--  الأعمدة كلها NULLABLE والـenums تبقى — لا تغيير سلوك حتى تبدأ الواجهة بقراءة الـkeys.
-- =============================================================================

-- 1) مفاتيح نصّية تَخلُف الـenums تدريجياً (NULL = استخدم الـenum القديم) ----------
ALTER TABLE orders          ADD COLUMN IF NOT EXISTS status_key   text;  -- يخلف order_status
ALTER TABLE order_items     ADD COLUMN IF NOT EXISTS status_key   text;  -- يخلف order_status
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS category_key text;  -- يخلف inventory_category
CREATE INDEX IF NOT EXISTS idx_orders_status_key          ON orders (tenant_id, status_key);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category_key ON inventory_items (tenant_id, category_key);

-- 2) config فئات المخزون لكل نشاط ------------------------------------------------
CREATE TABLE IF NOT EXISTS vertical_inventory_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_key  text NOT NULL REFERENCES verticals(key) ON DELETE CASCADE,
  category_key  text NOT NULL,
  label_ar      text NOT NULL,
  sort          int  NOT NULL DEFAULT 0,
  UNIQUE (vertical_key, category_key)
);

-- فئات الخياطة (رجالية + نسائية تشتركان) — مطابقة لقيم enum القديمة كـkeys
INSERT INTO vertical_inventory_categories(vertical_key, category_key, label_ar, sort) VALUES
  ('mens_tailoring','fabric','قماش',1),('mens_tailoring','thread','خيوط',2),
  ('mens_tailoring','button','أزرار',3),('mens_tailoring','lining','بطانة',4),
  ('mens_tailoring','accessories','إكسسوارات',5),('mens_tailoring','ready_made','جاهز',6),
  ('mens_tailoring','other','أخرى',7),
  ('womens_tailoring','fabric','قماش',1),('womens_tailoring','thread','خيوط',2),
  ('womens_tailoring','button','أزرار',3),('womens_tailoring','lining','بطانة',4),
  ('womens_tailoring','lace','دانتيل',5),('womens_tailoring','accessories','إكسسوارات',6),
  ('womens_tailoring','ready_made','جاهز',7),('womens_tailoring','other','أخرى',8),
  ('furniture','wood','خشب',1),('furniture','foam','إسفنج',2),
  ('furniture','upholstery_fabric','قماش تنجيد',3),('furniture','springs','نوابض',4),
  ('furniture','legs','أرجل',5),('furniture','accessories','إكسسوارات',6),
  ('furniture','other','أخرى',7)
ON CONFLICT (vertical_key, category_key) DO NOTHING;

-- 3) مراحل العمل: خياطة نسائية + أثاث ---------------------------------------------
INSERT INTO vertical_workflow_stages(vertical_key, stage_key, label_ar, sort, is_terminal) VALUES
  -- نسائية: تضيف مرحلة «بروفة» (fitting) المميِّزة للنسائي
  ('womens_tailoring','measurements_taken','تم أخذ المقاسات',1,false),
  ('womens_tailoring','cutting','قص',2,false),
  ('womens_tailoring','sewing','خياطة',3,false),
  ('womens_tailoring','embroidery','تطريز',4,false),
  ('womens_tailoring','fitting','بروفة/قياس',5,false),
  ('womens_tailoring','ironing_packaging','كي وتغليف',6,false),
  ('womens_tailoring','ready','جاهز',7,false),
  ('womens_tailoring','delivered','تم التسليم',8,true),
  ('womens_tailoring','cancelled','ملغي',9,true),
  -- أثاث: مسار مختلف كلياً
  ('furniture','order_received','استلام الطلب',1,false),
  ('furniture','design_approval','اعتماد التصميم',2,false),
  ('furniture','frame_building','تجهيز الهيكل',3,false),
  ('furniture','upholstery','تنجيد',4,false),
  ('furniture','finishing','تشطيب',5,false),
  ('furniture','quality_check','فحص الجودة',6,false),
  ('furniture','ready','جاهز للتسليم',7,false),
  ('furniture','delivered','تم التسليم',8,true),
  ('furniture','cancelled','ملغي',9,true)
ON CONFLICT (vertical_key, stage_key) DO NOTHING;

-- 4) schema حقول التخصيص لكل نشاط (تُخزَّن القيم في order_items.attributes) --------
INSERT INTO vertical_field_schemas(vertical_key, field_key, label_ar, field_type, options, applies_to, sort) VALUES
  -- رجالي (يعكس الأعمدة الحالية كـschema موحّد)
  ('mens_tailoring','collar_type','نوع الياقة','select','["كلاسيكي","صيني","مدوّر"]','order_item',1),
  ('mens_tailoring','cuff_type','نوع الكُم','select','["مفرد","مزدوج","بكبسون"]','order_item',2),
  ('mens_tailoring','pocket_type','نوع الجيب','select','["جانبي","صدر","مخفي"]','order_item',3),
  ('mens_tailoring','closure_type','نوع الإغلاق','select','["سحّاب","أزرار"]','order_item',4),
  ('mens_tailoring','collar_padding','تبطين الياقة','select','["قاسٍ","ناعم"]','order_item',5),
  ('mens_tailoring','embroidery','التطريز','text',NULL,'order_item',6),
  -- نسائي
  ('womens_tailoring','garment_type','نوع القطعة','select','["عباية","فستان","جلابية","تنورة"]','order_item',1),
  ('womens_tailoring','sleeve_style','قَصّة الكُم','select','["واسع","ضيّق","كلوش","بدون"]','order_item',2),
  ('womens_tailoring','neck_shape','شكل الرقبة','select','["دائري","V","قارب","مغلق"]','order_item',3),
  ('womens_tailoring','length','الطول (سم)','number',NULL,'order_item',4),
  ('womens_tailoring','lining','بطانة','bool',NULL,'order_item',5),
  ('womens_tailoring','embroidery','تطريز/زخرفة','text',NULL,'order_item',6),
  -- أثاث
  ('furniture','piece_type','نوع القطعة','select','["كنب","كرسي","مرتبة","ستارة","طاولة"]','order_item',1),
  ('furniture','upholstery_fabric','قماش التنجيد','select','["مخمل","جلد","قطن","كتّان"]','order_item',2),
  ('furniture','wood_type','نوع الخشب','select','["زان","سويد","MDF","صنوبر"]','order_item',3),
  ('furniture','foam_density','كثافة الإسفنج','select','["عالية","متوسطة","منخفضة"]','order_item',4),
  ('furniture','dimensions','الأبعاد','text',NULL,'order_item',5),
  ('furniture','color','اللون','text',NULL,'order_item',6)
ON CONFLICT (vertical_key, applies_to, field_key) DO NOTHING;

-- 5) RLS للجدول المرجعي الجديد ----------------------------------------------------
ALTER TABLE vertical_inventory_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vic_read ON vertical_inventory_categories;
CREATE POLICY vic_read ON vertical_inventory_categories FOR SELECT TO authenticated USING (true);

-- ملاحظة الانتقال: الواجهة تبدأ بكتابة status_key/category_key وقراءة التسميات من الـconfig.
-- بعد ترحيل كل الصفوف، يمكن (مرحلة 3) إسقاط الاعتماد على الـenums نهائياً.
