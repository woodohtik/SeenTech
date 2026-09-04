# مهمة شاملة: تفعيل نظام الأنشطة (Verticals) فعليًا في كل الواجهة + إضافة نشاطين جديدين

## 🎭 الدور (Role)
تصرف كـ **Senior Full-Stack Engineer** متخصص في React + TypeScript + Supabase (Postgres/RLS)، وفي عمليات الترحيل التدريجي غير الكاسرة (non-breaking incremental migration) لأنظمة SaaS متعددة المستأجرين قيد التشغيل فعليًا في الإنتاج.

ابدأ بعرض خطة عمل (Todo List) مرقّمة بكل الملفات التي ستنشئها/تعدّلها لكل مرحلة أدناه، نفّذها **مرحلة كاملة تلو الأخرى** (لا تخلط المراحل)، واعرض ملخصًا واختبارًا بعد كل مرحلة قبل الانتقال للتالية. **لا تدمج مرحلتين في التزام (commit) واحد.**

---

## 🎯 السياق — نتائج تدقيق فعلي على الكود (اقرأه كاملاً، لا تفترض)

النظام "سِين" يسوّق **5 أنشطة تجارية** في صفحة الهبوط (`src/components/LandingPage.html`)، لكن التدقيق الفعلي في الكود كشف 3 فجوات مجتمعة تجعل اختيار النشاط **بلا أي أثر حقيقي على ما يراه المستخدم**:

1. **طبقة الإعدادات (verticals / vertical_workflow_stages / vertical_field_schemas / vertical_inventory_categories) موجودة في القاعدة ومكتملة لـ 3 أنشطة فقط** (`mens_tailoring`, `womens_tailoring`, `furniture`) — أُنشئت في `MIGRATION_extensibility_stage1.sql` و`MIGRATION_extensibility_stage2.sql`. النشاطان الآخران المعلَنان في صفحة الهبوط (**محلات الأقمشة**، **ملابس متخصصة**) **لا وجود لهما إطلاقًا** في هذه الجداول.

2. **لا توجد أي شاشة في التطبيق تقرأ هذه الجداول.** تدقيق شامل عبر `src/` أظهر: صفر استدعاءات لـ `getWorkflowStages` / `getFieldSchemas` / `getInventoryCategories` / `listVerticals` خارج `verticalService.ts` نفسه. لا أحد يستورد `types/expansion.ts` غيره أيضًا. بالمقابل، الـ enum الثابت القديم (`order_status` / `inventory_category`) لا يزال مستخدَمًا فعليًا في **10 ملفات**، ومصطلحات الخياطة الرجالية مكتوبة حرفيًا (hardcoded) — "قماش"، "القياسات"، "الياقة"، "الكُم" — في **15 ملف** إضافي (`POS.tsx`, `DashboardOwner.tsx`, `Inventory/FabricUomConversion.tsx`, وغيرها). أي مستأجر — أيًا كان نشاطه المُختار — يرى نفس واجهة الخياطة الرجالية حرفيًا.

3. **مسار التسجيل الفعلي (`src/components/Login.tsx`, view=register) لا يطلب النشاط أصلاً ولا يضبط `tenants.vertical`.** حقل "نوع النشاط" الموجود في صفحة الهبوط هو جزء من **نموذج جذب عملاء (lead form)** منفصل تمامًا (رسالة النجاح: "نتواصل معك خلال يوم عمل لترتيب العرض") — وليس جزءًا من التسجيل الذاتي. كل مستأجر جديد يحصل على `vertical = 'mens_tailoring'` تلقائيًا من قيمة `DEFAULT` في العمود، بصرف النظر عمّا اختاره في نموذج التواصل.

**الخلاصة: هذه مهمة سد فجوة بين البنية التحتية الجاهزة والواجهة الفعلية — وليست بناء شيء من الصفر.** كل الجداول والخدمة (`verticalService.ts`) جاهزة وعامة تمامًا (لا كود خاص بنشاط معيّن فيها) — المطلوب توصيلها.

---

## 📦 نظرة عامة على المراحل

| المرحلة | الهدف | الخطورة |
|---|---|---|
| 1 | إكمال بيانات النشاطين الناقصين (SQL فقط) | منخفضة — بيانات غير كاسرة |
| 2 | ربط التسجيل الذاتي باختيار نشاط فعلي وحفظه | متوسطة — يضيف خطوة جديدة للـ onboarding |
| 3 | ترحيل شاشات الطلبات/المخزون من enum ثابت إلى config ديناميكي | **عالية — تمس مسارات إنتاج حية، نفّذها بحذر وبتوافق عكسي كامل** |
| 4 | تحقق شامل لكل الأنشطة الخمسة من التسجيل حتى التسليم | إلزامية قبل الإغلاق |

---

## 1️⃣ المرحلة 1: إكمال طبقة البيانات — `MIGRATION_extensibility_stage3_new_verticals.sql`

أنشئ ملف SQL بنفس نمط `ON CONFLICT DO NOTHING` المستخدم في stage1/stage2 (غير كاسر، آمن للتشغيل على الإنتاج):

```sql
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
```

**قبول المرحلة 1:** `SELECT key FROM verticals ORDER BY sort` يرجع 5 صفوف، وكل صف له مراحل عمل + حقول + فئات مخزون كاملة (استعلم بـ COUNT للتأكد لا صفوف فارغة).

---

## 2️⃣ المرحلة 2: ربط التسجيل الفعلي باختيار النشاط

1. أضف خطوة **"اختر نشاط محلك"** في مسار التسجيل الذاتي (`Login.tsx` view=register، أو أول شاشة onboarding بعد إنشاء الحساب إن وُجدت) — قائمة منسدلة تُملأ من `listVerticals()` (وليس ثابتة)، تعرض `name_ar` لكل نشاط.
2. عند إنشاء المستأجر، اكتب القيمة المختارة إلى `tenants.vertical` صراحة (بدل الاعتماد على `DEFAULT`).
3. إن كانت هذه الخطوة تُضاف بعد أن مستأجرين حاليين موجودين فعلاً بلا اختيار — لا تلمسهم؛ يبقون على `mens_tailoring` (توافقهم الحالي صحيح فعلاً بما أنه النشاط الوحيد المُستخدَم عمليًا حتى الآن).
4. **لا تغيّر** نموذج جذب العملاء في `LandingPage.html` — يبقى كما هو (منفصل عن التسجيل، لغرض تسويقي).

**قبول المرحلة 2:** تسجيل مستأجر جديد فعليًا من الواجهة (وليس عبر SQL يدوي) ينتج عنه صف `tenants` بقيمة `vertical` مطابقة لما اختاره المستخدم.

---

## 3️⃣ المرحلة 3: ترحيل الواجهة من enum ثابت إلى config ديناميكي

**هذه المرحلة الأهم والأخطر — نفّذها بنهج التوافق العكسي الكامل الذي اتّبعته stage1/stage2 نفسها: لا تحذف الـenum القديم، أضف الجديد بجانبه.**

أ. أنشئ hook واحد مركزي (مثلاً `src/hooks/useVerticalConfig.ts`) يستدعي `getTenantVertical` + `getWorkflowStages` + `getFieldSchemas` + `getInventoryCategories` مرة واحدة عند تحميل التطبيق للمستأجر الحالي، ويوفّرها عبر Context بدل استدعاء الخدمة من كل مكوّن.

ب. **شاشة/منطق حالة الطلب** (أي مكان يعرض أو يغيّر `order.status`): اعرض القائمة من `getWorkflowStages(vertical)` بدل القائمة الثابتة. عند تحديث الحالة، اكتب لكل من `status` (القديم، للتوافق) و`status_key` (الجديد) معًا.

ج. **شاشة/فورم إضافة صنف الطلب**: اعرض الحقول المُعرَّفة في `getFieldSchemas(vertical, 'order_item')` ديناميكيًا (بدل حقول الخياطة الرجالية الثابتة: `collar_type`, `cuff_type`...)، وخزّنها في `order_items.attributes` (jsonb، العمود موجود فعلاً من stage1). أبقِ أعمدة الخياطة الرجالية القديمة تعمل بلا تغيير لمستأجري `mens_tailoring` الحاليين (تحقق: هل تُقرأ من `attributes` أو من أعمدة مباشرة؟ إن كانت أعمدة مباشرة، اكتب لكليهما مؤقتًا).

د. **شاشة المخزون** (فئات الصنف): اعرض `getInventoryCategories(vertical)` بدل enum `inventory_category` الثابت، واكتب لكل من `category` (القديم) و`category_key` (الجديد).

هـ. **النصوص المكتوبة يدويًا (hardcoded)**: راجع الـ 15 ملفًا التالية تحديدًا وحدّد لكل واحد هل النص المكتوب (قماش/قياسات/الياقة...) هو تسمية عرض يجب أن تصبح ديناميكية، أم مصطلح عام لا يخص نشاطًا بعينه (مثل "الفاتورة"، "العميل") ولا يحتاج تغييرًا:
`AdminTailorCommissions.tsx`, `BillingSettings.tsx`, `CashOperationsModal.tsx`, `DashboardOwner.tsx`, `DashboardToday.tsx`, `Inventory/FabricUomConversion.tsx`, `POS.tsx`, `PurchaseOrders.tsx`, `SaaSAssistantSettings.tsx`, `SalesRecord.tsx`, `Settings.tsx`, `SuperAdminDashboard.tsx`, `SupplierLedger.tsx`, `Suppliers.tsx`, `pages/PublicInvoice.tsx`.
وثّق قرارك لكل ملف (غيّرته / تركته لأنه عام) — لا تخمّن بصمت.

**قبول المرحلة 3:**
- مستأجر بنشاط `furniture` يرى فعليًا مراحل عمل الأثاث (تصميم → هيكل → تنجيد → تشطيب)، لا مراحل الخياطة.
- مستأجر `mens_tailoring` قديم لا يلاحظ أي تغيير في سلوكه الحالي (retro-compatible).
- لا كسر في أي استعلام تقرير يعتمد على العمود القديم (`status`/`category`) — لا يزال مكتوبًا.

---

## 4️⃣ المرحلة 4: تحقق شامل إلزامي — لكل الأنشطة الخمسة

أنشئ 5 مستأجرين تجريبيين (واحد لكل نشاط) من مسار التسجيل الفعلي بعد المرحلة 2، ولكل واحد نفّذ دورة كاملة: إنشاء طلب → إضافة صنف بحقوله الصحيحة → تحريك الحالة عبر كل مراحل ذلك النشاط تحديدًا → تسليم. سجّل النتيجة في جدول:

| النشاط | حقول الصنف صحيحة؟ | مراحل العمل صحيحة؟ | فئات المخزون صحيحة؟ | ملاحظات |
|---|---|---|---|---|
| خياطة رجالية | | | | |
| خياطة نسائية | | | | |
| أثاث وتنجيد | | | | |
| محلات الأقمشة | | | | |
| ملابس متخصصة | | | | |

## ✅ معايير القبول النهائية (Definition of Done)

- [ ] الجدول أعلاه مكتمل بالكامل، بلا أي خانة فاشلة
- [ ] لا صف واحد في `vertical_workflow_stages` / `vertical_field_schemas` / `vertical_inventory_categories` فارغ لأي من الأنشطة الخمسة
- [ ] التسجيل الذاتي يضبط `tenants.vertical` فعليًا بناءً على اختيار المستخدم، وليس بالاعتماد على `DEFAULT` وحده
- [ ] مستأجرو `mens_tailoring` الحاليون في الإنتاج لا يلاحظون أي تغيير سلوكي (تحقق يدوي على بيئة staging قبل أي دمج لـ main)
- [ ] كل تعديل على enum قديم مصحوب بكتابة مزدوجة (قديم + جديد) — لا حذف لأي عمود أو enum في هذه المهمة
