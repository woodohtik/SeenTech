# إعادة تعريف حقول المقاسات ووحدة القياس — مواصفة

**الحالة:** معتمدة من المستخدم (محادثة عصف ذهني بتاريخ 2026-10-31) — جاهزة لخطة التنفيذ.

## الخلفية

حقول مقاسات الثوب الثمانية الحالية (`neck`, `chest`, `waist`, `hips`, `shoulder`,
`sleeve`, `length`, `bottomWidth`) معرَّفة في `src/types/index.ts` (`Measurements`)
ومستخدَمة في: نموذج الإدخال + رسم الثوب التفاعلي (`ThobeMeasurementSelector.tsx`)،
المعالج الصوتي (`VoiceMeasurementWizard.tsx` + `measurementWizardSteps.ts`)،
شاشات عرض الطلب/العميل (`Orders.tsx`, `Customers.tsx`)، وفحص القيم المنطقية
(`aiService.ts`). الوحدة معروضة حالياً كنص ثابت "سم" بدون أي نظام تحويل.

طلب المستخدم جزءان مستقلان لكن يُنفَّذان معاً لأنهما يلمسان نفس الشاشات:

1. استبدال 3 حقول (`waist`, `hips`, `bottomWidth`) بثلاثة حقول جديدة، وترتيب
   الحقول الثمانية بترتيب محدَّد.
2. وحدة قياس قابلة للتبديل (افتراضياً إنش) على مستوى التاجر، من الإعدادات.

## القرارات المعتمدة

- **الحقول الجديدة** (تحل محل `waist`/`hips`/`bottomWidth`):
  - `handWidth` — وسع اليد
  - `midSleeveWidth` — وسط الكم
  - `cuffLength` — طول الكبك (بمعنى كبك الكم عند الرسغ، نفس معنى `cuffType`
    الموجود حالياً في `Measurements`، وليس الياقة)
- **الترتيب الموحَّد** (في كل مكان تُعرض فيه الحقول الثمانية بالتسلسل):
  `length` → `shoulder` → `sleeve` → `chest` → `neck` → `handWidth` →
  `midSleeveWidth` → `cuffLength`
- **الحقول القديمة المحذوفة من الإدخال** (`waist`, `hips`, `bottomWidth`):
  - تُزال من نموذج الإدخال، رسم الثوب التفاعلي، والمعالج الصوتي.
  - **لا ترحيل ولا حذف بيانات**: تبقى في عمود `measurements` الحالي للعملاء
    القدامى كما هي، وتبقى شاشات العرض (`Orders.tsx`, `Customers.tsx`) تعرضها
    إن وُجدت قيمة (نفس منطق `.filter(m => m.value)` الحالي)، فقط بدون أي طريقة
    جديدة لتعديلها.
- **وحدة القياس**:
  - عمود جديد `tenants.measurement_unit` (`'cm' | 'inch'`)، افتراضي `'inch'`.
  - **التخزين يبقى بالسم دائماً** بغض النظر عن الوحدة المختارة. التحويل يحصل
    فقط عند العرض (سم → الوحدة النشطة) وعند الإدخال (الوحدة النشطة → سم قبل
    الحفظ)، تقريب لأقرب 0.1.
  - المعالج الصوتي: لا تغيير في فهم الرقم المنطوق (`parseArabicNumber` يبقى
    كما هو)؛ يُضاف تحويل الناتج للسم حسب الوحدة النشطة قبل `onChange`.
  - نطاقات `aiService.ts` (`SANE_RANGES`) تبقى مخزَّنة بالسم داخلياً،
    وتُحوَّل للوحدة النشطة فقط في نص رسالة التحذير المعروضة.

## 1) طبقة البيانات

### `src/types/index.ts`

```ts
export interface Measurements {
  length?: number;
  shoulder?: number;
  chest?: number;
  waist?: number;        // تبقى في النوع (بيانات قديمة)، تُزال من كل شاشات التحرير
  hips?: number;          // تبقى في النوع (بيانات قديمة)، تُزال من كل شاشات التحرير
  sleeve?: number;
  neck?: number;
  bottomWidth?: number;   // تبقى في النوع (بيانات قديمة)، تُزال من كل شاشات التحرير
  handWidth?: number;     // جديد: وسع اليد
  midSleeveWidth?: number;// جديد: وسط الكم
  cuffLength?: number;    // جديد: طول الكبك
  // ...بقية الحقول غير الرقمية بدون تغيير
}

export interface Tenant {
  // ...الحقول الحالية بدون تغيير
  measurementUnit?: 'cm' | 'inch'; // جديد، افتراضي 'inch' من الخادم عند الغياب
}
```

### مايجريشن جديد `supabase/migrations/20261107000000_tenants_measurement_unit.sql`

```sql
ALTER TABLE tenants
  ADD COLUMN measurement_unit TEXT NOT NULL DEFAULT 'inch'
  CHECK (measurement_unit IN ('cm', 'inch'));
```

لا حاجة لأي تعديل على `measurements` (JSONB حر على العميل/الطلب) — الحقول
الجديدة تُكتب فيه بنفس الآلية الحالية بدون تغيير مخطط قاعدة البيانات.

### `src/utils/measurementUnits.ts` (جديد)

```ts
export type MeasurementUnit = 'cm' | 'inch';

const CM_PER_INCH = 2.54;

/** يحوّل قيمة مخزَّنة بالسم للوحدة المطلوبة للعرض، مقرَّبة لأقرب 0.1. */
export function cmToDisplayUnit(cm: number, unit: MeasurementUnit): number;

/** يحوّل قيمة أدخلها المستخدم بالوحدة النشطة إلى سم للتخزين. */
export function displayUnitToCm(value: number, unit: MeasurementUnit): number;

/** تسمية الوحدة للعرض، عربي. */
export function unitLabel(unit: MeasurementUnit): string; // 'سم' | 'إنش'
```

### `src/hooks/useMeasurementUnit.ts` (جديد)

لا توجد اليوم أي آلية تُحمِّل إعدادات التاجر (غير `tenantId` نفسه) داخل
`Customers.tsx`/`Orders.tsx` — محاولة مشابهة سابقة لعرض `currencySymbol` لكل
الشاشات تبيّن إنها لم تُوصَّل فعلياً قط (موثَّقة في `src/App.tsx:323-329`).
بدل تكرار نفس الخطأ، هوك مخصَّص وخفيف:

```ts
/** يجلب وحدة القياس النشطة للتاجر (عمود واحد فقط)، افتراضي 'inch' أثناء
 *  التحميل أو عند أي خطأ -- لا يوقف عرض الشاشة بانتظار هذه القيمة. */
export function useMeasurementUnit(tenantId: string): MeasurementUnit;
```

يُستدعى من `Customers.tsx` و`Orders.tsx` (كلاهما يملك `tenantId` كـ prop
فعلاً)، ونتيجته تُمرَّر كـ prop جديد `measurementUnit` لـ
`ThobeMeasurementSelector`، وتُستخدم مباشرة في قوائم العرض الثابتة بنفس
الملفين (القسم 5).

## 2) الترتيب الموحَّد للحقول

### `src/utils/measurementWizardSteps.ts`

```ts
export type ThobePart =
  | 'neck' | 'chest' | 'shoulder' | 'sleeve' | 'length'
  | 'handWidth' | 'midSleeveWidth' | 'cuffLength';
// waist/hips/bottomWidth تُزال من هذا الاتحاد (غير قابلة للتحرير بعد اليوم)

export const MEASUREMENT_WIZARD_ORDER: ThobePart[] = [
  'length', 'shoulder', 'sleeve', 'chest', 'neck',
  'handWidth', 'midSleeveWidth', 'cuffLength',
];
```

نفس الاتحاد `ThobePart` يُحدَّث طبقه الأصلي في `ThobeMeasurementSelector.tsx`
(مكرَّر عمداً هناك كما هو موثَّق في تعليق الملف الحالي).

## 3) رسم الثوب التفاعلي (`ThobeMeasurementSelector.tsx`)

- `ThobeMeasurementSelectorProps`: إضافة `measurementUnit: MeasurementUnit`
  (مطلوب، يمرره كل مستدعٍ من نتيجة `useMeasurementUnit(tenantId)` الخاصة به).
- `PART_LABELS`/`PART_HINTS`: إعادة بناء بنفس الترتيب الجديد، بمفاتيح
  `handWidth`/`midSleeveWidth`/`cuffLength` بدل `waist`/`hips`/`bottomWidth`.
- إزالة مناطق SVG الثلاث: `part-waist` (الخصر)، `part-hips` (الأرداف)،
  `part-bottomWidth` (عرض الأسفل) — بما فيها حالات `coords` الخاصة بها في قسم
  "Value Labels".
- إضافة 3 مناطق ضغط جديدة قرب منطقة الكم الحالية (`part-sleeve`، السطور
  242-275): `part-handWidth` عند طرف الكم (الرسغ)، `part-midSleeveWidth` في
  منتصف مسار الكم، `part-cuffLength` عند شريط الكبك الموجود فعلاً في الرسم
  (مجموعة "Cuff Details"، السطور 270-274) — إحداثيات تقريبية تُضبط بصرياً أثناء
  التنفيذ، ليست جزءاً حاسماً من هذه المواصفة.
- قسم "Value Labels" (`Object.entries(values).map`): إضافة `case` لكل حقل
  جديد بإحداثيات قرب منطقته، وحذف حالات الحقول الثلاثة المزالة.
- قائمة الإدخال (`(Object.keys(PART_LABELS) as ThobePart[]).map`): تتبع
  الترتيب الجديد تلقائياً بما إن `PART_LABELS` مبني بنفس الترتيب. تسمية
  الوحدة (`{t('customers.cm')}`, السطر 457) تصبح ديناميكية عبر
  `unitLabel(measurementUnit)` (الـ prop الجديد أعلاه). قيمة الحقل المعروضة/المدخلة
  تمر عبر `cmToDisplayUnit`/`displayUnitToCm` (التخزين الداخلي في `values`
  يبقى بالسم كما هو اليوم؛ التحويل عند حدود العرض/الإدخال فقط).

## 4) المعالج الصوتي

- `VoiceMeasurementWizard.tsx`: يستقبل `measurementUnit` كـ prop إضافي
  (يمرره `ThobeMeasurementSelector` من نفس القيمة التي استقبلها هو). بعد
  `parseArabicNumber(transcript)`
  (بدون أي تغيير في هذه الدالة نفسها)، يُمرَّر الناتج عبر
  `displayUnitToCm(value, measurementUnit)` قبل `onChange`. النص المنطوق
  للمطالبة (`PART_LABELS[nextPart]`) يتبع نفس القاموس المحدَّث تلقائياً.
- `measurementWizardSteps.ts`: مذكور في القسم 2.

## 5) شاشات العرض (`Orders.tsx`, `Customers.tsx`)

- كل مكان يعرض قيمة مقاس (قوائم العرض الثابتة بالأسطر المذكورة في الاستكشاف:
  `Orders.tsx:1938-1945`, `3234-3239`, `3269-3276`) يحوّل القيمة المعروضة عبر
  `cmToDisplayUnit` قبل الطباعة، ويضيف وحدة العرض بجانب الرقم.
- هذه القوائم **لا تُحذف منها** `waist`/`hips`/`bottomWidth` — تبقى معروضة
  إن وُجدت قيمة (بيانات تاريخية)، فقط تُضاف الحقول الثلاثة الجديدة بجانبها
  بنفس النمط.

## 6) فحص القيم المنطقية (`src/services/aiService.ts`)

```ts
const SANE_RANGES: Partial<Record<keyof Measurements, [number, number]>> = {
  length: [120, 180],
  shoulder: [40, 60],
  chest: [85, 140],
  sleeve: [50, 70],
  neck: [33, 50],
  handWidth: [18, 28],      // نطاق تقديري أولي، يُراجَع مع التاجر إن لزم
  midSleeveWidth: [10, 18], // نطاق تقديري أولي
  cuffLength: [5, 12],      // نطاق تقديري أولي
};
```

`waist`/`hips` تُزالان من `SANE_RANGES` (لا تُفحصان بعد اليوم بما إنهما غير
قابلتين للتحرير).

ملاحظة استكشاف: `ruleBasedMeasurementChecks`/`checkMeasurementAnomalies` غير
مستدعاة من أي شاشة في التطبيق حالياً (الاستيراد الوحيد الموجود هو مثال في
تعليق التوثيق أعلى الملف) — تعديلها هنا بلا أي تأثير سلوكي على المستخدم
اليوم، فقط تحديث لتبقى متوافقة مع الحقول الجديدة.

`current`/`history` الممرَّرة لها مخزَّنة بالسم دائماً (نفس تخزين
`Measurements` الداخلي). التعديل: `ruleBasedMeasurementChecks` يستقبل معامل
ثالث اختياري `unit: MeasurementUnit = 'cm'`، ويحوّل `val`/`min`/`max` عبر
`cmToDisplayUnit` قبل بناء رسالة `flag_out_of_range`، حتى تكون جاهزة لأي
استدعاء مستقبلي يمرر الوحدة النشطة. نص المفتاح `measurements.flag_out_of_range`
الحالي "«{{field}}» = {{value}} سم خارج النطاق..." يصبح "«{{field}}» =
{{value}} {{unit}} خارج النطاق..." بمتغيّر `{{unit}}` جديد بدل النص الثابت
"سم".

## 7) الإعدادات (`Settings.tsx` + `server.ts`)

- تبويب "الملف الشخصي" (`activeTab === 'profile'`): حقل اختيار جديد (نفس نمط
  حقول التاجر الحالية) بعنوان "وحدة القياس الافتراضية للمقاسات"، خيارين
  (سم / إنش)، مربوط بـ `register('measurementUnit')`.
- `onSave` في `Settings.tsx`: يضيف `measurementUnit: data.measurementUnit`
  لكل من جسم طلب `/api/tenant/settings` (POST) ولـ `updatePayload` في مسار
  التراجع المباشر لـ Supabase (`measurement_unit: data.measurementUnit`).
- `server.ts`:
  - `GET /api/tenant/settings`: يضيف `measurementUnit: tenant.measurement_unit || 'inch'`
    لجسم الاستجابة.
  - `POST /api/tenant/settings`: يتحقق إن القيمة إحدى `'cm'`/`'inch'` فقط
    (وإلا 400)، ويضيفها لـ `updatePayload.measurement_unit`.
- أي شاشة تحتاج الوحدة النشطة لعرض/تحويل مقاس (POS غير معني هنا، فقط شاشات
  المقاسات) تستخدم `useMeasurementUnit(tenantId)` الموصوف في القسم 1، وليس
  قراءة مباشرة من كائن `Tenant` (لأن لا `Customers.tsx` ولا `Orders.tsx`
  يحمّلان صف التاجر الكامل اليوم).

## 8) الترجمة (`src/i18n/locales/{ar,en,ur}.json`)

مفاتيح جديدة تحت `measurements`:
- `measurements.handWidth`, `measurements.midSleeveWidth`, `measurements.cuffLength`
  (تسميات مسطّحة، لاستخدام `Orders.tsx`/`Customers.tsx`)
- `measurements.part_label.handWidth`, `.midSleeveWidth`, `.cuffLength`
- `measurements.part_hint.handWidth`, `.midSleeveWidth`, `.cuffLength`
- `measurements.unit_cm` = "سم", `measurements.unit_inch` = "إنش" (قيم
  `unitLabel()`)

مفاتيح `measurements.waist`, `.hips`, `.bottomWidth` و `part_label`/`part_hint`
المقابلة **تبقى بدون حذف** (لا تزال تُستخدم في شاشات العرض التاريخية).

مفتاح جديد تحت `settings_page.profile`:
- `settings_page.profile.measurement_unit` = "وحدة القياس الافتراضية للمقاسات"

## خارج النطاق (بالاتفاق مع المستخدم)

- أي ترحيل تلقائي أو تحويل بأثر رجعي لبيانات `waist`/`hips`/`bottomWidth`
  المخزَّنة سابقاً.
- أي إعداد وحدة على مستوى الفرع أو الموظف (الإعداد على مستوى التاجر فقط).
- تعديل `ThobeMeasurements` (النوع القديم غير المستخدم في `types/index.ts:3-10`
  — خارج نطاق هذا التغيير بالكامل).
