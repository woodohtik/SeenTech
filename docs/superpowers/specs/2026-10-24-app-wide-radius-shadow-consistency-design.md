# تصميم: توحيد زوايا البطاقات/النوافذ والظلال عبر كل شاشات التطبيق

## السياق

بعد تنظيف `SuperAdminDashboard.tsx` (commit `180c199`) من خمس قيم زوايا مختلطة (`rounded-[2rem]`, `rounded-[2.5rem]`, `rounded-3xl`, `rounded-2xl`, بعضها بقيم متغيرة حسب حجم الشاشة) إلى قيمة واحدة للبطاقات وأخرى للنوافذ، طلب المؤسس تطبيق نفس التحسين على بقية شاشات التطبيق. فحص فعلي (لا تخمين) أكّد أن المشكلة ليست محصورة بلوحة السوبر أدمن: **208 استخدام لزوايا عشوائية (`rounded-[...]`) عبر 50 ملفاً فعلياً**، بالإضافة إلى 22 استخدام لـ`hover:shadow-*` عبر 17 ملفاً يحتاج كل منها حكماً فردياً.

تم فصل هذا عن مشروع "إعادة الهندسة الهندسية" (كود ميت، استعلامات بلا ترقيم صفحات، ثغرات RLS) بقرار صريح من المؤسس: **المشروع البصري بالكامل أولاً، ثم الهندسي شاشة بشاشة لاحقاً** — المشروعان منفصلان تماماً، هذا التصميم يغطي البصري فقط.

## القاعدة (نفس قاعدة السوبر أدمن، بلا تغيير)

- **بطاقات المحتوى** (إحصائيات، جداول، أقسام، صفوف قوائم): زاوية واحدة `rounded-2xl`.
- **النوافذ/الحوارات** (modals، bottom sheets): زاوية واحدة `rounded-3xl`.
- **أزرار/حقول/شارات/صور دائرية**: تبقى كما هي (`rounded-xl`, `rounded-lg`, `rounded-full`) — لا تغيير، هذه ليست جزءاً من المشكلة.
- **لا قيم زوايا متغيرة حسب حجم الشاشة** (`sm:rounded-[...]`, `rounded-xl sm:rounded-2xl`, إلخ) — قيمة ثابتة واحدة لكل عنصر بكل الأحجام.
- **لا تغيير آخر**: الألوان، الخطوط، التخطيط العام، أي سلوك/منطق — تماماً كما كان في مهمة السوبر أدمن.

استثناء واحد مؤكَّد: `src/index.css:371` فيه `rounded-[var(--radius-card)]` — هذا توكن مصمَّم بالفعل (ليس قيمة عشوائية)، طابق نمط `grep` فقط صدفة. **خارج النطاق، لا يُلمَس.**

## الملفات في النطاق (50 ملفاً، 208 استخدام)

مرتَّبة تنازلياً بعدد الاستخدامات:

| الملف | العدد |
|---|---|
| `Reports.tsx` | 31 |
| `Inventory/InventoryManager.tsx` | 17 |
| `Orders.tsx` | 14 |
| `Settings.tsx` | 11 |
| `DashboardOwner.tsx` | 10 |
| `Staff.tsx` | 10 |
| `SaaSSystemSettings.tsx` | 9 |
| `Inventory/ProductFormFields.tsx` | 8 |
| `SaaSAssistantSettings.tsx` | 8 |
| `Customers.tsx` | 7 |
| `PrinterSettings.tsx` | 7 |
| `InvoiceLayoutSettings.tsx` | 5 |
| `PinLogin.tsx` | 5 |
| `BillingSettings.tsx` | 4 |
| `POS.tsx` | 4 |
| `RolePermissionsSettings.tsx` | 4 |
| `TenantAnalyticsDashboard.tsx` | 4 |
| `App.tsx` | 3 |
| `AdminTailors.tsx` | 3 |
| `MainSkeleton.tsx` | 3 |
| `Inventory/StockTransferWorkflow.tsx` | 3 |
| `WhatsAppSettings.tsx` | 3 |
| `Onboarding.tsx` | 2 |
| `PurchaseReturns.tsx` | 2 |
| `SaaSAuditLogs.tsx` | 2 |
| `SaaSReports.tsx` | 2 |
| `SaaSTeamManagement.tsx` | 2 |
| `SaaSWithdrawals.tsx` | 2 |
| `SalesRecord.tsx` | 2 |
| `CreditNotes.tsx` | 1 |
| `ErrorBoundary.tsx` | 1 |
| `PageSkeleton.tsx` | 1 |
| `PaymentVoucherModal.tsx` | 1 |
| `LockScreen.tsx` | 1 |
| `GlobalRoleManager.tsx` | 1 |
| `Inventory/ProductVariantsSection.tsx` | 1 |
| `Inventory/WarehouseManagement.tsx` | 1 |
| `PurchaseOrders.tsx` | 1 |
| `ResetPassword.tsx` | 1 |
| `Sales.tsx` | 1 |
| `SalesReturns.tsx` | 1 |
| `ShiftClosingModal.tsx` | 1 |
| `Suppliers.tsx` | 1 |
| `SupportConsentModal.tsx` | 1 |
| `ThobeMeasurementSelector.tsx` | 1 |
| `TaxInvoices.tsx` | 1 |
| `ZatcaOnboardingSettings.tsx` | 1 |
| `ui/LocationPickerModal.tsx` | 1 |
| `VisualMeasurements.tsx` | 1 |
| `ui/SmartSelect.tsx` | 1 |

## طريقة التنفيذ

لكل ملف: اقرأ كل استخدام `rounded-[...]` بسياقه (ليس استبدالاً أعمى)، صنّفه بطاقة أم نافذة بناءً على السياق (هل هو عنصر `fixed`/`position: fixed` بخلفية تعتيم خلفه = نافذة، أم عنصر عادي داخل تخطيط الصفحة = بطاقة)، ثم طبّق القاعدة. نفس الأسلوب المستخدَم فعلياً في commit `180c199`.

الملفات العشر الأولى (بينها 125 من أصل 208 استخدام، أكثر من النصف) تُعامَل كمهام مستقلة بسبب حجمها؛ الباقي (40 ملفاً، ≤4 كل منها) يُجمَّع في دفعات من 5-8 ملفات متقاربة الطبيعة (مثل كل شاشات SaaS الإدارية معاً، كل شاشات المخزون معاً).

### `hover:shadow-*` (22 استخدام، 17 ملفاً) — حكم فردي لا استبدال جماعي

كل حالة تُفحَص: هل العنصر الذي يحمل الـ`hover:shadow` فعلاً قابل للنقر (له `onClick`، أو هو بطاقة تنتقل لصفحة أخرى)؟
- إن كان قابلاً للنقر فعلاً: **يبقى كما هو** — الظل عند hover إشارة بصرية صحيحة للتفاعل.
- إن كان عنصراً ثابتاً بلا أي تفاعل: **يُحذَف** `hover:shadow-*` فقط (نفس إصلاح بطاقات KPI في السوبر أدمن).

القائمة الكاملة للفحص (ملف:سطر):
`CashOperationsModal.tsx:497,543` · `BillingSettings.tsx:457` · `Customers.tsx:1054,1994,2020` · `DashboardGridCard.tsx:34` · `DashboardOwner.tsx:1766,2352` · `GlobalRoleManager.tsx:342` · `Login.tsx:593` · `Orders.tsx:2501,2860` · `Inventory/WarehouseManagement.tsx:131` · `Inventory/StockTransferWorkflow.tsx:287` · `ResetPassword.tsx:141` · `SaaSReports.tsx:133` · `Inventory/InventoryManager.tsx:1274` · `Inventory/FabricUomConversion.tsx:486` · `Staff.tsx:1308` · `SeenAIFab.tsx:345` · `TenantAnalyticsDashboard.tsx:429`

### خارج النطاق تماماً (قرار صريح)

- أي إصلاح لـ`left-0`/`right-0` الحرفية (33 نتيجة، 17 ملفاً) — الفحص الأولي أظهر أغلبها إيجابيات كاذبة (عناصر متماثلة، أو مُعالَجة بالفعل عبر `rtl:`/شرط JS). لا تُفتَح هذه الملفات لهذا السبب في هذا المشروع.
- أي من بنود "إعادة الهندسة" (استعلامات بلا ترقيم صفحات، كود ميت، RLS) — مشروع منفصل لاحق، شاشة بشاشة.
- الألوان والخطوط ونظام v5.1 المؤجَّل — غير ذي صلة بهذا المشروع.

## الاختبار

- `npm run lint` (tsc) و`npm run build` بعد كل ملف أو دفعة ملفات — لا تغيير منطقي يُفترض أن يكسر شيئاً، لكن هذا يضمن عدم وجود خطأ JSX/syntax.
- لا اختبار بصري حي من طرفي (لا حساب اختبار، نفس قيد الجلسات السابقة) — الدفع يكون لـstaging فقط، والمؤسس يتحقق بصرياً من شاشات مختارة (الأعلى استخداماً: Reports.tsx, InventoryManager.tsx, Orders.tsx, Settings.tsx على الأقل) قبل أي طلب دفع للإنتاج.
- Commit لكل ملف كبير مستقل، وcommit واحد لكل دفعة من الملفات الصغيرة.
