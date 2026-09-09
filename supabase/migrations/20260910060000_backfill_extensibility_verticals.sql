-- =============================================================================
--  إعادة توثيق MIGRATION_extensibility_stage1/2/3.sql ضمن سجل الـmigrations
--  (seen-master-backlog-and-structure.md، خطوة 3)
--  ------------------------------------------------------------------------
--  verticals/vertical_workflow_stages/vertical_field_schemas/
--  vertical_inventory_categories -- جداول مرجعية حيّة (rls-audit هذه الجلسة
--  وجدها بسياسات SELECT USING(true) عامة، مقبولة لأنها بيانات مرجعية عامة
--  فعلاً) لكن غير موثَّقة في أي migration. الملفات الثلاثة الأصلية نظيفة
--  ومتطابقة تماماً مع الحالة الحيّة (idempotent بالفعل، ON CONFLICT DO
--  NOTHING في كل مكان)، فدُمجت هنا بلا أي تعديل على المنطق.
-- =============================================================================

-- ---- المرحلة 1 ----
CREATE TABLE IF NOT EXISTS public.verticals (
  key        text PRIMARY KEY,
  name_ar    text NOT NULL,
  name_en    text,
  is_active  boolean NOT NULL DEFAULT true,
  sort       int NOT NULL DEFAULT 0
);
INSERT INTO public.verticals(key, name_ar, name_en, sort) VALUES
  ('mens_tailoring',   'خياطة رجالية', 'Men''s Tailoring', 1),
  ('womens_tailoring', 'خياطة نسائية', 'Women''s Tailoring', 2),
  ('furniture',        'أثاث وتنجيد',  'Furniture & Upholstery', 3)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS vertical text NOT NULL DEFAULT 'mens_tailoring'
  REFERENCES public.verticals(key) ON UPDATE CASCADE;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS enabled_modules jsonb NOT NULL
  DEFAULT '["pos","orders","inventory","invoicing","customers"]'::jsonb;

ALTER TABLE public.order_items     ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.vertical_workflow_stages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_key  text NOT NULL REFERENCES public.verticals(key) ON DELETE CASCADE,
  stage_key     text NOT NULL,
  label_ar      text NOT NULL,
  sort          int  NOT NULL DEFAULT 0,
  is_terminal   boolean NOT NULL DEFAULT false,
  UNIQUE (vertical_key, stage_key)
);
INSERT INTO public.vertical_workflow_stages(vertical_key, stage_key, label_ar, sort, is_terminal) VALUES
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

CREATE TABLE IF NOT EXISTS public.vertical_field_schemas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_key  text NOT NULL REFERENCES public.verticals(key) ON DELETE CASCADE,
  field_key     text NOT NULL,
  label_ar      text NOT NULL,
  field_type    text NOT NULL DEFAULT 'text',
  options       jsonb,
  applies_to    text NOT NULL DEFAULT 'order_item',
  sort          int NOT NULL DEFAULT 0,
  UNIQUE (vertical_key, applies_to, field_key)
);

ALTER TABLE public.verticals               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vertical_workflow_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vertical_field_schemas  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS verticals_read ON public.verticals;
CREATE POLICY verticals_read ON public.verticals FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS vws_read ON public.vertical_workflow_stages;
CREATE POLICY vws_read ON public.vertical_workflow_stages FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS vfs_read ON public.vertical_field_schemas;
CREATE POLICY vfs_read ON public.vertical_field_schemas FOR SELECT TO authenticated USING (true);

-- ---- المرحلة 2 ----
ALTER TABLE public.orders          ADD COLUMN IF NOT EXISTS status_key   text;
ALTER TABLE public.order_items     ADD COLUMN IF NOT EXISTS status_key   text;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS category_key text;
CREATE INDEX IF NOT EXISTS idx_orders_status_key            ON public.orders (tenant_id, status_key);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category_key ON public.inventory_items (tenant_id, category_key);

CREATE TABLE IF NOT EXISTS public.vertical_inventory_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_key  text NOT NULL REFERENCES public.verticals(key) ON DELETE CASCADE,
  category_key  text NOT NULL,
  label_ar      text NOT NULL,
  sort          int  NOT NULL DEFAULT 0,
  UNIQUE (vertical_key, category_key)
);

INSERT INTO public.vertical_inventory_categories(vertical_key, category_key, label_ar, sort) VALUES
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

INSERT INTO public.vertical_workflow_stages(vertical_key, stage_key, label_ar, sort, is_terminal) VALUES
  ('womens_tailoring','measurements_taken','تم أخذ المقاسات',1,false),
  ('womens_tailoring','cutting','قص',2,false),
  ('womens_tailoring','sewing','خياطة',3,false),
  ('womens_tailoring','embroidery','تطريز',4,false),
  ('womens_tailoring','fitting','بروفة/قياس',5,false),
  ('womens_tailoring','ironing_packaging','كي وتغليف',6,false),
  ('womens_tailoring','ready','جاهز',7,false),
  ('womens_tailoring','delivered','تم التسليم',8,true),
  ('womens_tailoring','cancelled','ملغي',9,true),
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

INSERT INTO public.vertical_field_schemas(vertical_key, field_key, label_ar, field_type, options, applies_to, sort) VALUES
  ('mens_tailoring','collar_type','نوع الياقة','select','["كلاسيكي","صيني","مدوّر"]','order_item',1),
  ('mens_tailoring','cuff_type','نوع الكُم','select','["مفرد","مزدوج","بكبسون"]','order_item',2),
  ('mens_tailoring','pocket_type','نوع الجيب','select','["جانبي","صدر","مخفي"]','order_item',3),
  ('mens_tailoring','closure_type','نوع الإغلاق','select','["سحّاب","أزرار"]','order_item',4),
  ('mens_tailoring','collar_padding','تبطين الياقة','select','["قاسٍ","ناعم"]','order_item',5),
  ('mens_tailoring','embroidery','التطريز','text',NULL,'order_item',6),
  ('womens_tailoring','garment_type','نوع القطعة','select','["عباية","فستان","جلابية","تنورة"]','order_item',1),
  ('womens_tailoring','sleeve_style','قَصّة الكُم','select','["واسع","ضيّق","كلوش","بدون"]','order_item',2),
  ('womens_tailoring','neck_shape','شكل الرقبة','select','["دائري","V","قارب","مغلق"]','order_item',3),
  ('womens_tailoring','length','الطول (سم)','number',NULL,'order_item',4),
  ('womens_tailoring','lining','بطانة','bool',NULL,'order_item',5),
  ('womens_tailoring','embroidery','تطريز/زخرفة','text',NULL,'order_item',6),
  ('furniture','piece_type','نوع القطعة','select','["كنب","كرسي","مرتبة","ستارة","طاولة"]','order_item',1),
  ('furniture','upholstery_fabric','قماش التنجيد','select','["مخمل","جلد","قطن","كتّان"]','order_item',2),
  ('furniture','wood_type','نوع الخشب','select','["زان","سويد","MDF","صنوبر"]','order_item',3),
  ('furniture','foam_density','كثافة الإسفنج','select','["عالية","متوسطة","منخفضة"]','order_item',4),
  ('furniture','dimensions','الأبعاد','text',NULL,'order_item',5),
  ('furniture','color','اللون','text',NULL,'order_item',6)
ON CONFLICT (vertical_key, applies_to, field_key) DO NOTHING;

ALTER TABLE public.vertical_inventory_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vic_read ON public.vertical_inventory_categories;
CREATE POLICY vic_read ON public.vertical_inventory_categories FOR SELECT TO authenticated USING (true);

-- ---- المرحلة 3 ----
INSERT INTO public.verticals(key, name_ar, name_en, sort) VALUES
  ('fabric_store', 'محلات الأقمشة', 'Fabric Store', 4)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.vertical_workflow_stages(vertical_key, stage_key, label_ar, sort, is_terminal) VALUES
  ('fabric_store','order_received','استلام الطلب',1,false),
  ('fabric_store','cutting_measuring','قص وقياس بالمتر',2,false),
  ('fabric_store','ready_pickup','جاهز للاستلام',3,false),
  ('fabric_store','delivered','تم التسليم',4,true),
  ('fabric_store','cancelled','ملغي',5,true)
ON CONFLICT (vertical_key, stage_key) DO NOTHING;

INSERT INTO public.vertical_field_schemas(vertical_key, field_key, label_ar, field_type, options, applies_to, sort) VALUES
  ('fabric_store','fabric_type','نوع القماش','select','["قطن","حرير","كتان","صوف","بوليستر","دانتيل"]','order_item',1),
  ('fabric_store','color','اللون','text',NULL,'order_item',2),
  ('fabric_store','pattern','النقشة/الطباعة','text',NULL,'order_item',3),
  ('fabric_store','sale_unit','وحدة البيع','select','["متر","لفة كاملة"]','order_item',4),
  ('fabric_store','quantity_meters','الكمية (متر)','number',NULL,'order_item',5),
  ('fabric_store','width_cm','عرض القماش (سم)','number',NULL,'order_item',6)
ON CONFLICT (vertical_key, applies_to, field_key) DO NOTHING;

INSERT INTO public.vertical_inventory_categories(vertical_key, category_key, label_ar, sort) VALUES
  ('fabric_store','cotton','قطن',1),('fabric_store','silk','حرير',2),
  ('fabric_store','linen','كتان',3),('fabric_store','wool','صوف',4),
  ('fabric_store','synthetic','صناعي/بوليستر',5),('fabric_store','lace','دانتيل',6),
  ('fabric_store','accessories','إكسسوارات خياطة',7),('fabric_store','other','أخرى',8)
ON CONFLICT (vertical_key, category_key) DO NOTHING;

INSERT INTO public.verticals(key, name_ar, name_en, sort) VALUES
  ('specialty_clothing', 'ملابس متخصصة', 'Specialty Clothing', 5)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.vertical_workflow_stages(vertical_key, stage_key, label_ar, sort, is_terminal) VALUES
  ('specialty_clothing','order_received','استلام الطلب',1,false),
  ('specialty_clothing','design_approval','اعتماد التصميم/الشعار',2,false),
  ('specialty_clothing','cutting','قص',3,false),
  ('specialty_clothing','sewing','خياطة',4,false),
  ('specialty_clothing','printing_embroidery','طباعة/تطريز الشعار',5,false),
  ('specialty_clothing','quality_check','فحص الجودة',6,false),
  ('specialty_clothing','ready','جاهز',7,false),
  ('specialty_clothing','delivered','تم التسليم',8,true),
  ('specialty_clothing','cancelled','ملغي',9,true)
ON CONFLICT (vertical_key, stage_key) DO NOTHING;

INSERT INTO public.vertical_field_schemas(vertical_key, field_key, label_ar, field_type, options, applies_to, sort) VALUES
  ('specialty_clothing','uniform_type','نوع الزي','select','["مدرسي","طبي","شركات","رياضي","أخرى"]','order_item',1),
  ('specialty_clothing','quantity','الكمية','number',NULL,'order_item',2),
  ('specialty_clothing','size_range','نطاق المقاسات','text',NULL,'order_item',3),
  ('specialty_clothing','fabric_type','نوع القماش','select','["قطن","بوليستر","تريكو","مقاوم للبقع"]','order_item',4),
  ('specialty_clothing','color','اللون','text',NULL,'order_item',5),
  ('specialty_clothing','logo_placement','موضع الشعار','text',NULL,'order_item',6)
ON CONFLICT (vertical_key, applies_to, field_key) DO NOTHING;

INSERT INTO public.vertical_inventory_categories(vertical_key, category_key, label_ar, sort) VALUES
  ('specialty_clothing','fabric','قماش',1),('specialty_clothing','thread','خيوط',2),
  ('specialty_clothing','buttons','أزرار',3),('specialty_clothing','zippers','سحابات',4),
  ('specialty_clothing','logos_patches','شعارات وشارات',5),('specialty_clothing','accessories','إكسسوارات',6),
  ('specialty_clothing','other','أخرى',7)
ON CONFLICT (vertical_key, category_key) DO NOTHING;
