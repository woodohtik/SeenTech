-- =============================================================================
--  سِين — هجرة التمدّد (المرحلة 3) — إضافة نشاطين جديدين: محلات الأقمشة + ملابس متخصصة
--  غير كاسرة (ON CONFLICT DO NOTHING)، بنفس نمط stage1/stage2 تماماً.
--  تشترط تطبيق stage1 + stage2 أولاً (verticals / vertical_workflow_stages /
--  vertical_field_schemas / vertical_inventory_categories يجب أن تكون موجودة).
-- =============================================================================

-- محلات الأقمشة (بيع بالتجزئة/الجملة، وليس تصنيعًا — مسار أبسط)
INSERT INTO verticals(key, name_ar, name_en, sort) VALUES
  ('fabric_store', 'محلات الأقمشة', 'Fabric Store', 4)
ON CONFLICT (key) DO NOTHING;

INSERT INTO vertical_workflow_stages(vertical_key, stage_key, label_ar, sort, is_terminal) VALUES
  ('fabric_store','order_received','استلام الطلب',1,false),
  ('fabric_store','cutting_measuring','قص وقياس بالمتر',2,false),
  ('fabric_store','ready_pickup','جاهز للاستلام',3,false),
  ('fabric_store','delivered','تم التسليم',4,true),
  ('fabric_store','cancelled','ملغي',5,true)
ON CONFLICT (vertical_key, stage_key) DO NOTHING;

INSERT INTO vertical_field_schemas(vertical_key, field_key, label_ar, field_type, options, applies_to, sort) VALUES
  ('fabric_store','fabric_type','نوع القماش','select','["قطن","حرير","كتان","صوف","بوليستر","دانتيل"]','order_item',1),
  ('fabric_store','color','اللون','text',NULL,'order_item',2),
  ('fabric_store','pattern','النقشة/الطباعة','text',NULL,'order_item',3),
  ('fabric_store','sale_unit','وحدة البيع','select','["متر","لفة كاملة"]','order_item',4),
  ('fabric_store','quantity_meters','الكمية (متر)','number',NULL,'order_item',5),
  ('fabric_store','width_cm','عرض القماش (سم)','number',NULL,'order_item',6)
ON CONFLICT (vertical_key, applies_to, field_key) DO NOTHING;

INSERT INTO vertical_inventory_categories(vertical_key, category_key, label_ar, sort) VALUES
  ('fabric_store','cotton','قطن',1),('fabric_store','silk','حرير',2),
  ('fabric_store','linen','كتان',3),('fabric_store','wool','صوف',4),
  ('fabric_store','synthetic','صناعي/بوليستر',5),('fabric_store','lace','دانتيل',6),
  ('fabric_store','accessories','إكسسوارات خياطة',7),('fabric_store','other','أخرى',8)
ON CONFLICT (vertical_key, category_key) DO NOTHING;

-- ملابس متخصصة (تفصيل بالجملة لجهات: مدارس، مستشفيات، شركات)
INSERT INTO verticals(key, name_ar, name_en, sort) VALUES
  ('specialty_clothing', 'ملابس متخصصة', 'Specialty Clothing', 5)
ON CONFLICT (key) DO NOTHING;

INSERT INTO vertical_workflow_stages(vertical_key, stage_key, label_ar, sort, is_terminal) VALUES
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

INSERT INTO vertical_field_schemas(vertical_key, field_key, label_ar, field_type, options, applies_to, sort) VALUES
  ('specialty_clothing','uniform_type','نوع الزي','select','["مدرسي","طبي","شركات","رياضي","أخرى"]','order_item',1),
  ('specialty_clothing','quantity','الكمية','number',NULL,'order_item',2),
  ('specialty_clothing','size_range','نطاق المقاسات','text',NULL,'order_item',3),
  ('specialty_clothing','fabric_type','نوع القماش','select','["قطن","بوليستر","تريكو","مقاوم للبقع"]','order_item',4),
  ('specialty_clothing','color','اللون','text',NULL,'order_item',5),
  ('specialty_clothing','logo_placement','موضع الشعار','text',NULL,'order_item',6)
ON CONFLICT (vertical_key, applies_to, field_key) DO NOTHING;

INSERT INTO vertical_inventory_categories(vertical_key, category_key, label_ar, sort) VALUES
  ('specialty_clothing','fabric','قماش',1),('specialty_clothing','thread','خيوط',2),
  ('specialty_clothing','buttons','أزرار',3),('specialty_clothing','zippers','سحابات',4),
  ('specialty_clothing','logos_patches','شعارات وشارات',5),('specialty_clothing','accessories','إكسسوارات',6),
  ('specialty_clothing','other','أخرى',7)
ON CONFLICT (vertical_key, category_key) DO NOTHING;
