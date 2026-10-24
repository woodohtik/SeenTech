# توحيد زوايا البطاقات/النوافذ والظلال عبر التطبيق — خطة التنفيذ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** طبّق قاعدة الزاوية الواحدة للبطاقات (`rounded-2xl`) والواحدة للنوافذ (`rounded-3xl`) — نفس قاعدة `SuperAdminDashboard.tsx` (commit `180c199`) — على كل الزوايا العشوائية (`rounded-[...]`) المتبقية في التطبيق (208 استخدام، 50 ملفاً)، وراجع كل استخدام `hover:shadow-*` مريب (22 استخدام، 17 ملفاً) بحكم فردي لإزالة ما لا يخص عنصراً قابلاً للنقر فعلياً.

**Architecture:** لا بنية جديدة — تطبيع className بحت على ملفات موجودة، ملفاً بملف أو دفعة ملفات صغيرة متقاربة الطبيعة. كل مهمة مستقلة تماماً عن غيرها (لا تداخل بين الملفات)، فالترتيب بين المهام غير مهم.

**Tech Stack:** React + TypeScript + Tailwind v4 (التعديل كله على `className` strings).

**Spec:** `docs/superpowers/specs/2026-10-24-app-wide-radius-shadow-consistency-design.md`

## Global Constraints

- بطاقات المحتوى → `rounded-2xl` فقط. نوافذ/حوارات → `rounded-3xl` فقط. لا قيمة أخرى.
- لا قيم زوايا متغيرة حسب حجم الشاشة (`sm:rounded-[...]`, `rounded-xl sm:rounded-2xl` على عنصر "بطاقة/نافذة") — قيمة ثابتة واحدة بكل الأحجام.
- أزرار/حقول/شارات/عناصر دائرية (`rounded-xl`, `rounded-lg`, `rounded-full`) لا تُلمَس.
- لا تغيير ألوان، خطوط، تخطيط، أو أي سلوك/منطق في أي ملف.
- `src/index.css:371` (`rounded-[var(--radius-card)]`) خارج النطاق تماماً — توكن مصمَّم، ليس خللاً.
- `left-0`/`right-0` الحرفية خارج النطاق تماماً في هذه الخطة.

## Review Focus

- **نافذة مصنَّفة خطأً كبطاقة (أو العكس):** إن أُعطيت نافذة حقيقية (عنصر `fixed` بخلفية تعتيم) زاوية `rounded-2xl` بدل `rounded-3xl`، النتيجة بصرية بحتة لا تكسر شيئاً وظيفياً -- لكن كل مهمة تطبع العناصر المصنَّفة "نافذة" مقابل "بطاقة" في سجل العمل (ledger) ليراجعها القارئ.
- **زاوية عشوائية نسيَ المنفِّذ تطبيعها** (مثل سطر لم يظهر في الـgrep الأصلي لأن الملف تغيَّر): خطوة التحقق `grep -c` في كل مهمة تكشف أي تبقٍّ بالضبط، لا تخمين.
- **`hover:shadow` حُذِف من عنصر قابل للنقر فعلياً** (مثل بطاقة طلب تنتقل لصفحة التفاصيل عند الضغط): المهمتان المخصَّصتان لهذا البند (18 و19) تتحققان من وجود `onClick`/`cursor-pointer`/`<Link>` على نفس العنصر قبل الحذف، لا حذف أعمى.
- **ملف يحمل زاوية ضمن قالب متكرر (`.map()`)**: الاستبدال يطبَّق على نص JSX المصدر مرة واحدة (يشمل كل عناصر القالب تلقائياً) -- التأكد أن الاستبدال في مصدر القالب لا في نسخة واحدة فقط من عنصر مُولَّد.
- **ملف فيه زاوية عشوائية تبدو بطاقة لكنها فعلياً popover/tooltip/dropdown طائر** (مستوى "الطاير" لا "البطاقة" ولا "النافذة" -- مثل قوائم SmartSelect المنسدلة): هذه ليست بطاقة بالمعنى الذي يغطيه الـSpec ولا نافذة حوار كاملة؛ المهمة المخصَّصة لـ`ui/SmartSelect.tsx` (مهمة 17) تسجّل القرار صريحاً (الأقرب لنافذة بسبب `shadow-2xl`/`fixed`، أم بطاقة) بدل افتراض صامت.

---

## النمط المشترك لكل مهمة (اقرأه مرة واحدة، يُطبَّق في كل المهام أدناه)

1. **اقرأ** كل سطر فيه `rounded-[...]` في ملف(ات) المهمة عبر `grep -n "rounded-\[" <file>` (الأعداد أدناه هي ما وُجد يوم كتابة هذه الخطة؛ أعد الفحص لأن الملف قد يكون تغيَّر).
2. **صنّف** كل عنصر: نافذة (عنصر `fixed`/`position: fixed` مع طبقة تعتيم خلفه `bg-black/`, يُغلَق بزر X أو نقرة خارجه) أم بطاقة (أي شيء آخر ثابت داخل تخطيط الصفحة). عند الشك، طبّق "قاعدة الطاير" في Review Focus أعلاه وسجّل القرار.
3. **عدّل** كل سطر: استبدل قيمة الزاوية العشوائية بـ`rounded-2xl` (بطاقة) أو `rounded-3xl` (نافذة)، واحذف أي جزء متغيّر حسب حجم الشاشة من قيمة الزاوية نفسها (مثل `sm:rounded-[2.5rem]` تُحذَف بالكامل إن كانت تعديلاً على نفس عنصر الزاوية الأساسية).
4. **تحقَّق**: شغّل `grep -c "rounded-\[" <file>` لكل ملف في المهمة. **Expected: 0** لكل ملف (الاستثناء الوحيد في كل هذه الخطة هو `src/index.css`، غير مذكور في أي مهمة).
5. **Lint**: شغّل `npm run lint`. **Expected:** نجاح بلا أخطاء جديدة.
6. **Commit** بملفات المهمة فقط.

كل مهمة أدناه تحدّد فقط: الملفات، العدد المرصود حالياً (للمقارنة السريعة)، وأي ملاحظة تصنيف خاصة إن وُجدت. لا تُكرَّر الخطوات الست أعلاه نصاً في كل مهمة.

---

### Task 1: `Reports.tsx` (31 استخدام)

**Files:** Modify: `src/components/Reports.tsx`

تطبيق النمط المشترك. ملف كبير بما يكفي ليُفحَص بالكامل أولاً (`grep -n`) قبل أي تعديل لتكوين صورة شاملة عن توزيع بطاقة/نافذة فيه قبل البدء.

### Task 2: `Inventory/InventoryManager.tsx` (17 استخدام)

**Files:** Modify: `src/components/Inventory/InventoryManager.tsx`

تطبيق النمط المشترك. يحتوي `AddItemModal`/`EditItemModal` (نوافذ حقيقية) بجانب بطاقات القائمة الرئيسية -- صنّف بعناية.

### Task 3: `Orders.tsx` (14 استخدام)

**Files:** Modify: `src/components/Orders.tsx`

تطبيق النمط المشترك.

### Task 4: `Settings.tsx` (11 استخدام)

**Files:** Modify: `src/components/Settings.tsx`

تطبيق النمط المشترك.

### Task 5: `DashboardOwner.tsx` (10 استخدام)

**Files:** Modify: `src/components/DashboardOwner.tsx`

تطبيق النمط المشترك. ملاحظة: `hover:shadow-xl` على بطاقات هذا الملف (سطرا 1766 و2352) مرتبطة ببند `hover:shadow` (مهمة 19)، لا تُلمَس هنا.

### Task 6: `Staff.tsx` (10 استخدام)

**Files:** Modify: `src/components/Staff.tsx`

تطبيق النمط المشترك.

### Task 7: `SaaSSystemSettings.tsx` (9 استخدام)

**Files:** Modify: `src/components/SaaSSystemSettings.tsx`

تطبيق النمط المشترك. (نفس الملف الذي أُضيفت له بطاقة التحويل البنكي و2FA هذا الأسبوع -- تأكَّد أن تعديل الزوايا لا يغيّر تلك الأقسام المضافة حديثاً وظيفياً، فقط زاويتها إن كانت عشوائية.)

### Task 8: `Inventory/ProductFormFields.tsx` (8 استخدام)

**Files:** Modify: `src/components/Inventory/ProductFormFields.tsx`

تطبيق النمط المشترك.

### Task 9: `SaaSAssistantSettings.tsx` (8 استخدام)

**Files:** Modify: `src/components/SaaSAssistantSettings.tsx`

تطبيق النمط المشترك.

### Task 10: `Customers.tsx` (7 استخدام)

**Files:** Modify: `src/components/Customers.tsx`

تطبيق النمط المشترك. ملاحظة: سطرا 1994 و2020 فيهما أيضاً `hover:shadow-md` -- مرتبط بمهمة 18، لا يُحذَف هنا.

### Task 11: دفعة إعدادات التاجر الفرعية (5 ملفات، ~20 استخدام)

**Files:** Modify:
- `src/components/PrinterSettings.tsx` (7)
- `src/components/InvoiceLayoutSettings.tsx` (5)
- `src/components/RolePermissionsSettings.tsx` (4)
- `src/components/WhatsAppSettings.tsx` (3)
- `src/components/ZatcaOnboardingSettings.tsx` (1)

تطبيق النمط المشترك على كل ملف من الخمسة، تحقّق `grep -c` لكل واحد على حدة، commit واحد للدفعة كاملة.

### Task 12: دفعة شاشات المصادقة والتهيئة (5 ملفات، ~10 استخدامات)

**Files:** Modify:
- `src/components/PinLogin.tsx` (5)
- `src/components/Onboarding.tsx` (2)
- `src/components/LockScreen.tsx` (1)
- `src/components/ResetPassword.tsx` (1)
- `src/components/SupportConsentModal.tsx` (1)

تطبيق النمط المشترك. `SupportConsentModal.tsx` نافذة حوار بالاسم نفسه -- الأرجح `rounded-3xl`، تحقَّق من البنية فعلياً قبل الحسم.

### Task 13: دفعة شاشات السوبر أدمن الشقيقة (5 ملفات، ~11 استخدام)

**Files:** Modify:
- `src/components/AdminTailors.tsx` (3)
- `src/components/SaaSAuditLogs.tsx` (2)
- `src/components/SaaSReports.tsx` (2)
- `src/components/SaaSTeamManagement.tsx` (2)
- `src/components/SaaSWithdrawals.tsx` (2)

تطبيق النمط المشترك.

### Task 14: دفعة المخزون والمشتريات الصغيرة (6 ملفات، ~9 استخدامات)

**Files:** Modify:
- `src/components/Inventory/StockTransferWorkflow.tsx` (3)
- `src/components/Inventory/ProductVariantsSection.tsx` (1)
- `src/components/Inventory/WarehouseManagement.tsx` (1)
- `src/components/PurchaseReturns.tsx` (2)
- `src/components/PurchaseOrders.tsx` (1)
- `src/components/Suppliers.tsx` (1)

تطبيق النمط المشترك.

### Task 15: دفعة نقطة البيع والمبيعات (8 ملفات، ~12 استخدام)

**Files:** Modify:
- `src/components/POS.tsx` (4)
- `src/components/Sales.tsx` (1)
- `src/components/SalesRecord.tsx` (2)
- `src/components/SalesReturns.tsx` (1)
- `src/components/ShiftClosingModal.tsx` (1)
- `src/components/PaymentVoucherModal.tsx` (1)
- `src/components/CreditNotes.tsx` (1)
- `src/components/TaxInvoices.tsx` (1)

تطبيق النمط المشترك. `ShiftClosingModal.tsx`/`PaymentVoucherModal.tsx` نوافذ بالاسم -- الأرجح `rounded-3xl` بعد التحقق الفعلي من البنية.

### Task 16: دفعة الفوترة والعرض المشترك (6 ملفات، ~16 استخدام)

**Files:** Modify:
- `src/components/BillingSettings.tsx` (4)
- `src/components/TenantAnalyticsDashboard.tsx` (4)
- `src/App.tsx` (3)
- `src/components/MainSkeleton.tsx` (3)
- `src/components/PageSkeleton.tsx` (1)
- `src/components/ErrorBoundary.tsx` (1)

تطبيق النمط المشترك. `App.tsx` الاستخدامات الثلاثة (سطور 142، 440، 485 يوم كتابة الخطة) هي شاشات خطأ/أوفلاين كاملة الشاشة -- نوافذ بمعنى الـSpec، الأرجح `rounded-3xl`.

### Task 17: دفعة العناصر المشتركة المتبقية (5 ملفات، ~5 استخدامات)

**Files:** Modify:
- `src/components/GlobalRoleManager.tsx` (1)
- `src/components/ThobeMeasurementSelector.tsx` (1)
- `src/components/VisualMeasurements.tsx` (1)
- `src/components/ui/LocationPickerModal.tsx` (1)
- `src/components/ui/SmartSelect.tsx` (1)

تطبيق النمط المشترك. `ui/LocationPickerModal.tsx` نافذة بالاسم. `ui/SmartSelect.tsx` قائمة منسدلة طائرة -- سجّل القرار (بطاقة أم نافذة) صريحاً في الـledger بدل افتراضه صامتاً، حسب "قاعدة الطاير" في Review Focus.

---

### Task 18: مراجعة `hover:shadow` -- الدفعة الأولى (7 ملفات)

**Files:** Modify (فقط إن استوجب الحذف):
- `src/components/CashOperationsModal.tsx:497,543`
- `src/components/BillingSettings.tsx:457`
- `src/components/Customers.tsx:1054,1994,2020`
- `src/components/DashboardGridCard.tsx:34`
- `src/components/DashboardOwner.tsx:1766,2352`
- `src/components/GlobalRoleManager.tsx:342`
- `src/components/Login.tsx:593`

لكل سطر: اقرأ العنصر الحامل لـ`hover:shadow-*` وتحقَّق هل عليه `onClick`، أو هو داخل `<Link>`/`<button>`، أو `cursor-pointer` في className نفسها كإشارة تصميمية لقابلية النقر. إن كان أي من هذه موجوداً فعلاً: **لا تغيّر شيئاً** في هذا السطر. إن لم يكن: احذف جزء `hover:shadow-*` فقط من الـclassName (كل شيء آخر في السطر يبقى كما هو). سجّل في رسالة الـcommit عدد الأسطر التي حُذِف منها الـhover مقابل عدد الأسطر التي بقيت.

**Verify:** `npm run lint` نجاح. لا أمر grep آلي هنا (القرار بشري لكل سطر، ليس عداداً ميكانيكياً).

**Commit** بالملفات المعدَّلة فعلياً فقط من هذه القائمة.

### Task 19: مراجعة `hover:shadow` -- الدفعة الثانية (10 ملفات)

**Files:** Modify (فقط إن استوجب الحذف):
- `src/components/Orders.tsx:2501,2860`
- `src/components/Inventory/WarehouseManagement.tsx:131`
- `src/components/Inventory/StockTransferWorkflow.tsx:287`
- `src/components/ResetPassword.tsx:141`
- `src/components/SaaSReports.tsx:133`
- `src/components/Inventory/InventoryManager.tsx:1274`
- `src/components/Inventory/FabricUomConversion.tsx:486`
- `src/components/Staff.tsx:1308`
- `src/components/SeenAIFab.tsx:345`
- `src/components/TenantAnalyticsDashboard.tsx:429`

نفس إجراء مهمة 18 حرفياً، على هذه القائمة.

**Verify:** `npm run lint` نجاح.

**Commit** بالملفات المعدَّلة فعلياً فقط من هذه القائمة.

---

### Task 20: التحقق النهائي الشامل

**Files:** لا تعديل -- تحقق فقط.

- [ ] **Step 1:** شغّل `grep -rn "rounded-\[" src/` بالكامل. **Expected:** نتيجة واحدة فقط (`src/index.css:371`)، صفر في كل ملفات `.tsx`.
- [ ] **Step 2:** شغّل `npm run build`. **Expected:** نجاح بلا أخطاء.
- [ ] **Step 3:** شغّل `npm run test`. **Expected:** كل الاختبارات الحالية (166) ناجحة بلا تغيير -- هذه الخطة لا تضيف منطقاً جديداً، فلا اختبارات جديدة متوقَّعة.
- [ ] **Step 4:** Commit إن وُجد أي تبقٍّ طفيف غاب عن المهام السابقة (نادر، لكن يُغلق هنا بدل تركه).

---

## ملاحظة تنفيذية

19 مهمة تطبيع + مهمتا مراجعة + تحقق نهائي = 20 مهمة، كل واحدة مستقلة تماماً (لا Interfaces بين المهام إطلاقاً -- كلها className بحت على ملفات لا تستورد من بعضها لهذا الغرض). هذا يرشّح الخطة بقوة لتنفيذ Native/inline (نفس ما حدث مع `SuperAdminDashboard.tsx` الأصلي) بدل Subagent-driven -- 20 subagent منفصلاً لعمل مطابقة نص لا قيمة مضافة منه هنا، على عكس حين تحمل كل مهمة قراراً تصميمياً أو منطقياً حقيقياً.
