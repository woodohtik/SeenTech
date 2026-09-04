# مهمة: ضبط النظام حسب حجم الشاشة (Responsive Audit & Fix)

## 🎭 الدور (Role)
تصرف كـ **Senior Frontend Engineer** متخصص في Tailwind CSS وتصميم متجاوب (Responsive/Mobile-First). لديك في هذا المشروع مهارتان مثبّتتان استخدمهما مباشرة قبل أي تعديل:
- `ui-styling` → مرجع `references/tailwind-responsive.md` (نقاط الكسر sm/md/lg/xl/2xl وأنماط mobile-first الجاهزة) و`references/tailwind-utilities.md`.
- `ui-ux-pro-max` → ابحث بـ `python "${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py" "<كلمة>" --domain ux` لأي حالة استجابة أو حجم لمس محدّدة قبل أن تقرر الحل بنفسك.

ابدأ بعرض خطة عمل (Todo List)، ونفّذها ملفًا تلو الآخر — **لا تُصلح كل شيء دفعة واحدة**، لأن بعض القيم الثابتة أدناه قد تكون صحيحة عمدًا (أيقونة 24px مثلاً) وتحتاج حكمًا لا استبدالاً أعمى.

---

## 🎯 السياق — نتائج تدقيق فعلي (وليس افتراضًا)

- **الخط العام جيد فعلاً**: 82 من أصل 129 ملف `.tsx` يستخدمون بالفعل كلاسات استجابة Tailwind (`sm:`/`md:`/`lg:`) — المشروع ليس بلا استجابة، لكنه غير مكتمل/غير متسق.
- **`viewport meta` صحيح بالفعل** في `index.html` (`width=device-width, initial-scale=1, viewport-fit=cover`) — لا حاجة لأي تعديل هنا، تحقّق فقط أنه لم يُمس.
- **3 ملفات فيها جداول بدون غلاف `overflow-x`** (ستنكسر أو تسبب تمريرًا أفقيًا لكامل الصفحة على الجوال):
  - `src/components/printing/TaxInvoice.tsx`
  - `src/components/ReportPrintDocument.tsx`
  - `src/components/SaaSWithdrawals.tsx`
  (ملاحظة: هذان الأولان مستندا طباعة — تحقّق هل هما يُعرَضان أصلاً على شاشة جوال، أم مخصصان للطباعة/الديسكتوب فقط؛ إن كانا للطباعة حصرًا فالإصلاح اختياري)
- **33 ملفًا فيها عرض/ارتفاع ثابت بالبكسل** (`w-[Npx]`, `width: Npx`, `min-width: Npx`) — أعلاه القائمة الكاملة، لا تخمّن ملفات إضافية ولا تفوّت واحدًا منها:
  `AdminTailorCommissions.tsx`, `AdminTailors.tsx`, `BillingSettings.tsx`, `CashOperationsModal.tsx`, `CashierDashboard.tsx`, `CreditNotes.tsx`, `Customers.tsx`, `DashboardOwner.tsx`, `Inventory.tsx`, `Inventory/InventoryAdjustment.tsx`, `Inventory/InventoryManager.tsx`, `Layout.tsx`, `LockScreen.tsx`, `Login.tsx`, `Onboarding.tsx`, `Orders.tsx`, `POS.tsx`, `PaymentVoucherModal.tsx`, `PrinterSettings.tsx`, `Reports.tsx`, `ResetPassword.tsx`, `SaaSTeamManagement.tsx`, `SalesRecord.tsx`, `SeenAIFab.tsx`, `ShiftHistory.tsx`, `SuperAdminDashboard.tsx`, `SupplierLedger.tsx`, `SuppliersRegistry.tsx`, `TailorStatementReport.tsx`, `ThobeMeasurementSelector.tsx`, `ZReport.tsx`, `pos/CartSidebar.tsx`, `contexts/ToastContext.tsx`

---

## 1️⃣ إصلاح الجداول الثلاثة (أولوية أولى، منخفضة الخطورة)

لكل ملف من الثلاثة: لفّ عنصر `<table>` بحاوية `<div className="overflow-x-auto">...</div>` بدل أي إصلاح آخر — هذا نمط قياسي موجود بالفعل في 26 ملفًا آخر من أصل 29 في المشروع، فقط طبّق نفس النمط.

## 2️⃣ تدقيق الـ 33 ملفًا ذات القياس الثابت (العمل الأساسي)

لكل ملف، لكل قيمة `px` ثابتة وجدتها، صنّفها لإحدى ثلاث فئات واعمل وفقها:

| الفئة | مثال | الإجراء |
|---|---|---|
| **يجب أن يتجاوب** | `w-[320px]` على بطاقة/نافذة منبثقة (modal) أو عمود جدول رئيسي | استبدله بعرض نسبي + `max-w-*` (مثل `w-full max-w-sm`) أو أضف breakpoint (`w-full md:w-[320px]`) |
| **صحيح عمدًا** | أيقونة 20-24px، شعار صغير، سماكة حد (border) | اتركه كما هو — لا تغيّره |
| **يحتاج حد أدنى فقط** | `min-width: 200px` لعمود جدول حتى لا ينضغط بشكل غير قابل للقراءة | أبقِ `min-width` لكن تأكد أن الحاوية الأب فيها `overflow-x-auto` |

استخدم مرجع `ui-styling/references/tailwind-responsive.md` للنمط الصحيح في كل حالة (خصوصًا قسم "Layout Changes" و"Responsive Patterns").

**ابدأ بالملفات الأكثر استخدامًا يوميًا من الكاشير/الموظف على الأرجح على أجهزة لوحية (tablet) أو جوال في المحل** (رتبها بهذا الترتيب): `POS.tsx` → `CartSidebar.tsx` → `Orders.tsx` → `Customers.tsx` → `CashierDashboard.tsx` → `Inventory.tsx` → الباقي.

## 3️⃣ فحص حجم عناصر اللمس (Touch Targets)

بما أن هذا نظام كاشير يُستخدم غالبًا على تابلت/جوال في المحل: افحص كل زر/أيقونة قابلة للنقر في `POS.tsx` و`CartSidebar.tsx` و`Layout.tsx` (شريط التنقل) — يجب ألا يقل أي عنصر تفاعلي عن `44×44px` (استشر `--domain ux` في `ui-ux-pro-max` بكلمات مثل `"touch target size"` أو `"minimum tap area"` قبل التعديل).

## 4️⃣ اختبار نهائي إلزامي

افتح كل شاشة رئيسية (تسجيل الدخول، POS، الطلبات، العملاء، المخزون، لوحة السوبر أدمن) على 4 عروض شاشة: `375px` (جوال)، `768px` (تابلت عمودي)، `1024px` (تابلت أفقي/لابتوب صغير)، `1440px` (ديسكتوب). سجّل النتيجة:

| الشاشة | 375px | 768px | 1024px | 1440px |
|---|---|---|---|---|
| تسجيل الدخول | | | | |
| POS | | | | |
| الطلبات | | | | |
| العملاء | | | | |
| المخزون | | | | |
| لوحة السوبر أدمن | | | | |

معيار النجاح لكل خانة: **لا تمرير أفقي غير مقصود، لا نص مقطوع، لا زر أصغر من منطقة اللمس، لا تراكب عناصر.**

## ✅ معايير القبول (Definition of Done)

- [ ] الملفات الثلاثة (الجداول) مغلّفة بـ `overflow-x-auto`
- [ ] كل ملف من الـ 33 تم تصنيفه صراحة (يتجاوب / صحيح عمدًا / يحتاج حد أدنى) — لا ملف بلا قرار موثّق
- [ ] لا تمرير أفقي على مستوى الصفحة كاملة (`body`) على أي عرض من الأربعة
- [ ] جدول الاختبار النهائي مكتمل بالكامل بلا خانة فاشلة
- [ ] `viewport meta` في `index.html` لم يُمس
