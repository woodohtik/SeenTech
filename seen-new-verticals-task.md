# مهمة: بناء نشاطين جديدين مُعلَن عنهما في صفحة الهبوط ولم يُبنَيا بعد — محلات الأقمشة + الملابس المتخصصة

## 🎭 الدور (Role)
تصرف كـ **Senior Full-Stack Engineer** متخصص في:
- PostgreSQL + Supabase (RLS، Migrations)
- React + TypeScript + Vite
- بنية "طبقة المجال المدفوعة بالـ config" (Config-Driven Vertical Layer) المستخدمة فعليًا في هذا المشروع

ابدأ بعرض خطة عمل (Todo List) بكل الملفات التي ستنشئها/تعدّلها، نفّذها ملفًا تلو الآخر، واعرض ملخصًا بعد كل خطوة.

---

## 🎯 السياق (Context) — اقرأه كاملاً قبل الكتابة

صفحة الهبوط (`src/components/LandingPage.html`) تسوّق **5 أنشطة تجارية** في قسم "الأنشطة التجارية التي نخدمها" ونموذج التسجيل (`<select id="activity">`):

1. خياطة رجالية — ✅ مبني بالكامل (`vertical_key = 'mens_tailoring'`)
2. خياطة نسائية — ✅ مبني بالكامل (`vertical_key = 'womens_tailoring'`)
3. كنب وستائر (باسم "أثاث وتنجيد" في القاعدة) — ✅ مبني بالكامل (`vertical_key = 'furniture'`)
4. **محلات الأقمشة** — ❌ **غير موجود إطلاقًا** في القاعدة
5. **ملابس متخصصة** — ❌ **غير موجود إطلاقًا** في القاعدة

أي عميل يختار أحد النشاطين الأخيرين من نموذج التسجيل يدخل نظامًا بلا مراحل عمل، بلا حقول تخصيص، وبلا فئات مخزون مناسبة له — **هذه فجوة حقيقية بين التسويق والمنتج**، ومهمتك سدّها.

### البنية الموجودة فعليًا (لا تُنشئ بنية جديدة — استخدم نفس الجداول)

المشروع يستخدم نمط "طبقة مجال مدفوعة بالـ config" أُسِّس في `MIGRATION_extensibility_stage1.sql` و`MIGRATION_extensibility_stage2.sql`، عبر 4 جداول مرجعية:

| الجدول | الوظيفة |
|---|---|
| `verticals` | قائمة الأنشطة (`key`, `name_ar`, `name_en`, `is_active`, `sort`) |
| `vertical_workflow_stages` | مراحل سير العمل لكل نشاط (`stage_key`, `label_ar`, `sort`, `is_terminal`) — تحل محل enum `order_status` |
| `vertical_field_schemas` | حقول التخصيص لكل نشاط (`field_key`, `label_ar`, `field_type`, `options`, `applies_to`) — تُخزَّن القيم في `order_items.attributes` (jsonb) |
| `vertical_inventory_categories` | فئات المخزون لكل نشاط (`category_key`, `label_ar`, `sort`) — تحل محل enum `inventory_category` |

طبقة القراءة جاهزة فعلاً في `src/services/verticalService.ts` (`listVerticals`, `getWorkflowStages`, `getFieldSchemas`, `getInventoryCategories`) وهي **عامة تمامًا ولا تحتوي أي كود خاص بنشاط معيّن** — أي أن إضافة نشاط جديد يجب أن تكون **بيانات فقط (SQL seed)**، بدون تعديل هذا الملف، تمامًا كما حصل مع `furniture` في stage2.

---

## 📦 المخرجات المطلوبة (Deliverables)

| # | الملف | الوصف |
|---|---|---|
| 1 | `MIGRATION_extensibility_stage3_new_verticals.sql` | كل الـ INSERT statements أدناه، بنفس نمط stage1/stage2 (`ON CONFLICT DO NOTHING`) |
| 2 | تعديل `src/components/LandingPage.html` | لا تعديل مطلوب على القائمة (الأنشطة الخمسة تبقى كما هي) — فقط تأكد أن قيمة `<option>` النصية تطابق `name_ar` في القاعدة حرفيًا لتفادي أي عدم تطابق لاحق عند ربط النموذج بالـ backend |
| 3 | فحص (بدون تعديل افتراضي) لأي مكان في الكود يفترض ضمنيًا أن الأنشطة الثلاثة القديمة فقط هي كل الاحتمالات (enum ثابت، switch/case، أو قائمة hardcoded) | وثّق ما وجدته، وإذا وجدت كودًا كهذا فقط حينها عدّله |

---

## 1️⃣ نشاط "محلات الأقمشة" — `vertical_key = 'fabric_store'`

هذا نشاط **بيع بالتجزئة/بالجملة** وليس تصنيعًا بالكامل مثل الخياطة — الطلبات الأغلب فورية (بيع بالمتر)، مع إمكانية طلب قص/حجز. مسار عمل مبسّط:

```sql
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
  ('fabric_store','cotton','قطن',1),
  ('fabric_store','silk','حرير',2),
  ('fabric_store','linen','كتان',3),
  ('fabric_store','wool','صوف',4),
  ('fabric_store','synthetic','صناعي/بوليستر',5),
  ('fabric_store','lace','دانتيل',6),
  ('fabric_store','accessories','إكسسوارات خياطة',7),
  ('fabric_store','other','أخرى',8)
ON CONFLICT (vertical_key, category_key) DO NOTHING;
```

---

## 2️⃣ نشاط "ملابس متخصصة" — `vertical_key = 'specialty_clothing'`

هذا نشاط **تفصيل بالجملة لجهات** (زي مدرسي، طبي/سكرَبز، شركات، رياضي) — الطلبات غالبًا بكميات كبيرة وتتطلب اعتماد تصميم/شعار قبل التنفيذ:

```sql
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
  ('specialty_clothing','fabric','قماش',1),
  ('specialty_clothing','thread','خيوط',2),
  ('specialty_clothing','buttons','أزرار',3),
  ('specialty_clothing','zippers','سحابات',4),
  ('specialty_clothing','logos_patches','شعارات وشارات',5),
  ('specialty_clothing','accessories','إكسسوارات',6),
  ('specialty_clothing','other','أخرى',7)
ON CONFLICT (vertical_key, category_key) DO NOTHING;
```

---

## 3️⃣ خطوة تحقق إلزامية قبل الإغلاق

1. أنشئ مستأجرًا تجريبيًا (test tenant) بـ `vertical = 'fabric_store'` وآخر بـ `vertical = 'specialty_clothing'`، وتأكد أن:
   - شاشة الطلبات تعرض مراحل العمل الصحيحة لكل منهما (وليست مراحل الخياطة الرجالية الافتراضية).
   - نموذج إضافة صنف الطلب يعرض حقول التخصيص الصحيحة لكل نشاط.
   - شاشة المخزون تعرض فئات المخزون الصحيحة لكل نشاط.
2. ابحث في الكود عن أي مكان يفترض ضمنيًا وجود 3 أنشطة فقط (خاصة أي enum TypeScript قديم لـ `order_status`/`inventory_category` ما زال مستخدَمًا مباشرة بدل `status_key`/`category_key`) ووثّق ما وجدته حتى لو لم تُصلحه ضمن هذه المهمة.
3. لا تُعدّل `DEFAULT_VERTICAL` في `verticalService.ts` — يبقى `'mens_tailoring'` كما هو، هذان نشاطان إضافيان اختياريان عند التسجيل فقط.

## ✅ معايير القبول (Definition of Done)

- [ ] `verticals` تحتوي الآن 5 صفوف (3 القديمة + `fabric_store` + `specialty_clothing`)، بنفس التسميات العربية الحرفية الموجودة في `LandingPage.html`
- [ ] كل نشاط جديد له مراحل عمل + حقول تخصيص + فئات مخزون كاملة (لا صفوف فارغة)
- [ ] مستأجر تجريبي على كل نشاط جديد يعمل من التسجيل حتى التسليم بدون أي خطأ أو مرحلة مفقودة
- [ ] `verticalService.ts` لم يُعدَّل (يبقى عامًا كما هو)
- [ ] لا تغيير على سلوك `mens_tailoring` / `womens_tailoring` / `furniture` الحاليين (migration غير كاسرة، بنفس فلسفة stage1/stage2)
