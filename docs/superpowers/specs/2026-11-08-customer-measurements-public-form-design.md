# مواصفة: فورم مقاسات عام للعميل (Public Customer Measurements Form)

**الحالة:** مُعتمَدة من المستخدم (محادثة brainstorming، 2026-11-08) — جاهزة لكتابة خطة التنفيذ.

## الهدف

عند إضافة أو تعديل عميل في نظام "سِين"، يقدر الموظف يرسل للعميل رابطاً عاماً
(بلا تسجيل دخول، بلا حساب) يفتحه العميل من جواله ويملأ/يعدّل مقاساته بنفسه.
المقاسات تُحفظ فوراً في ملف العميل بمجرد الإرسال — بلا طابور مراجعة من
الموظف.

**من يستخدمها:** موظف/مدير المحل (يرسل الرابط) والعميل النهائي (يفتح الرابط
ويملأ الفورم). كلاهما بلا حاجة لتثبيت تطبيق أو إنشاء حساب.

**معيار النجاح:** رابط واحد لكل عميل، يبقى صالحاً دائماً، يفتح فورم مطابقاً
تماماً لما يستخدمه الموظف اليوم عند تعديل مقاسات عميل، ويحفظ التعديلات مباشرة
في `customers.measurements`.

## القرارات المعتمَدة من المستخدم

1. **الحفظ فوري وتلقائي** — لا توجد حالة "بانتظار المراجعة". إرسال الفورم
   يكتب في `customers.measurements` مباشرة.
2. **الرابط دائم** — نفس الرمز (token) يبقى صالحاً للعميل إلى الأبد، يقدر
   يرجع له ويعدّل مقاساته أي وقت لاحقاً. لا تاريخ انتهاء، لا حالة
   "مستخدم/غير مستخدم". (توليد رمز جديد لإبطال القديم — خارج نطاق هذا
   التنفيذ، يُترك لمرحلة لاحقة إن طُلب.)
3. **الفورم العام = نفس فورم الموظف بالكامل** — إعادة استخدام
   `VisualMeasurements.tsx` و`ThobeMeasurementSelector.tsx` كما هما، بلا أي
   تبسيط أو حذف حقول.
4. **زر "إرسال رابط المقاسات" يظهر في كل مكان**: في نموذج إضافة/تعديل عميل
   (بعد الحفظ)، وأيضاً كزر مباشر بجانب كل عميل في قائمة/بطاقات العملاء.

## القرار المعماري — لماذا نفس نمط `/track/:token` وليس RPC+RLS مباشر

هذا المشروع لديه سابقة مطابقة تماماً، موثَّقة في
`docs/reports/PUBLIC_TRACKING_SPEC.md`: صفحة تتبّع الطلب العامة
(`/track/:token`). نفس الأسباب المعمارية المذكورة هناك تنطبق هنا حرفياً:

1. **تحديد المعدّل (rate limiting) يحتاج IP حقيقي موثوق** — غير متوفر بثقة
   داخل Postgres خلف مجمِّع اتصالات PostgREST، لكنه متوفر في `server.ts`
   (Express مع `trust proxy: 1`).
2. **توحيد النمط مع ما هو موجود فعلاً** — بدل اختراع RPC جديد + `GRANT`
   لـ`anon`، نمرّ عبر `server.ts` بـ`supabaseAdmin` (يتجاوز RLS) مع اختيار
   حقول صريح يدوياً.

**النتيجة:** لا RPC جديد، لا `GRANT` جديد لـ`anon`. كل القراءة/الكتابة
العامة تمر حصراً عبر مسارين في `server.ts` (قسم "المسارات" أدناه).

**تحديد المعدّل يُعاد استخدامه بالكامل:** الدالة `checkTrackingRateLimit`
وجدول `tracking_attempts` الموجودان فعلاً في `server.ts` مُستخدَمان فعلاً
عبر أكثر من مسار واحد (`/api/public/invoices/:id`,
`/api/public/order-tracking/:token`, `/api/public/order-tracking/:token/subscribe`,
`/api/public/order-lookup`) — نفس الدالة تُستدعى هنا أيضاً، بلا أي جدول أو
منطق تحديد-معدّل جديد.

## 1) قاعدة البيانات

ملف جديد: `supabase/migrations/20261113000000_customers_measurements_token.sql`

```sql
ALTER TABLE customers ADD COLUMN IF NOT EXISTS measurements_token UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_measurements_token ON customers (measurements_token);
```

- عشوائي بالكامل (UUID v4) — غير مشتق من `customers.id`، لا يكشف الرابط
  العام معرّف الصف الداخلي (نفس تحليل `tracking_token`).
- `DEFAULT gen_random_uuid()` يولّده تلقائياً لكل عميل جديد **بلا أي تعديل**
  على منطق إنشاء العميل في `Customers.tsx`/`POS.tsx`. العملاء الموجودون
  مسبقاً يحصلون على رمز فريد تلقائياً عند تطبيق الـ migration (نفس سلوك
  `tracking_token` الموثَّق في `PUBLIC_TRACKING_SPEC.md`).
- بلا `ON DELETE`/FK إضافي — العمود مستقل، لا يغيّر أي قيد موجود على الجدول.

## 2) الأنواع (TypeScript)

`src/types/index.ts` — إضافة حقل واحد اختياري لـ `Customer` (موجود حالياً
`:103-121` تقريباً):
```ts
export interface Customer {
  // ... الحقول الموجودة بلا تغيير
  measurementsToken?: string;
}
```

`src/components/Customers.tsx` — إضافة `measurementsToken: c.measurements_token`
لحلقة التعيين camelCase الموجودة فعلاً في `customersQuery` (`:241-249`)، بجانب
`isTest`/`isB2B`/`companyName` الحالية — نفس النمط تماماً، سطر واحد إضافي.

## 3) مساران عامان جديدان في `server.ts`

يوضَعان بجانب مسارات `/api/public/order-tracking/*` الموجودة فعلاً
(بعد السطر ~528)، يعيدان استخدام `TRACKING_TOKEN_RE` و`checkTrackingRateLimit`
و`clientIp` الموجودين فعلاً بلا أي تكرار.

### `GET /api/public/measurements/:token`

**المدخل:** `token` — يُرفض فوراً بـ404 (بلا استعلام) إن لم يطابق شكل UUID
(نفس `TRACKING_TOKEN_RE`).

**تحديد معدّل:** `checkTrackingRateLimit` (نفس الجدول المشترك).

**الاستعلام:**
```ts
supabaseAdmin
  .from('customers')
  .select('name, measurements, tenant:tenants(name, logo_url, measurement_unit)')
  .eq('measurements_token', token)
  .maybeSingle();
```

**المخرج (200):**
```json
{
  "customer_name": "أحمد محمد",
  "shop_name": "خياطة الأناقة",
  "shop_logo_url": "https://...",
  "measurement_unit": "cm",
  "measurements": { "length": 140, "chest": 52, "collarType": "classic", "...": "..." }
}
```
لا شيء آخر يُرجَع — لا هاتف العميل، لا `customers.id`، لا `tenant_id`، لا أي
حقل داخلي آخر من `tenants`.

**404:** لا يوجد عميل بهذا الرمز (أو شكل الرمز غير صالح أصلاً).
**429:** تجاوز حد المحاولات لعنوان IP هذا.

### `POST /api/public/measurements/:token`

**المدخل:** `token` (نفس التحقق) + `body.measurements` (كائن).

**تحديد معدّل:** نفس `checkTrackingRateLimit` (مشترك مع GET أعلاه، بنفس
منطق "يزيد العدّاد فقط عند توكِن غير موجود" — عميل شرعي يعدّل مقاساته
مراراً لا يُعاقَب أبداً).

**التحقق من `body.measurements` (دالة تحقق جديدة، صغيرة ومُختبَرة):**
- يُرفض إن لم يكن كائناً (object)، أو إن احتوى أي مفتاح خارج مفاتيح
  `Measurements` المعروفة (`length, shoulder, chest, waist, hips, sleeve,
  neck, bottomWidth, handWidth, midSleeveWidth, cuffLength, collarType,
  cuffType, pocketType, chestStyle, shoulderStyle, cuttingType,
  collarPadding, thobeMeasurements, closureType, closureVisibility`).
- الحقول الرقمية: يجب أن تكون `number` محدود (`Number.isFinite`)، ضمن
  `0–300` (سم) — نفس المدى المنطقي لمقاس جسم بشري، يمنع قيماً سالبة أو
  ضخمة عبثية.
- `thobeMeasurements` (إن وُجد): كائن فرعي بنفس تحقق الحقول الرقمية الستة
  (`collar, chest, shoulders, sleeves, length, bottomWidth`).
- `collarPadding` ∈ `{'hard','soft'}`, `closureType` ∈ `{'zipper','buttons'}`,
  `closureVisibility` ∈ `{'hidden','visible'}` — تحقق enum صارم (هذه قيم
  TypeScript union ثابتة فعلاً).
- بقية الحقول النصية (`collarType`, `cuffType`, `pocketType`, `chestStyle`,
  `shoulderStyle`, `cuttingType`): `string` بحد أقصى 40 حرفاً (بلا قائمة
  enum صارمة على الخادم، لتفادي تكرار/انجراف قوائم الخيارات المرئية في
  `VisualMeasurements.tsx` — القيمة غير المعروفة تُحفظ لكن لا تُطابق أي خيار
  مرئي عند العرض لاحقاً، بلا أي خطر XSS لأنها لا تُعرض كـHTML خام في أي
  مكان).
- أي خلل في التحقق → `400` برسالة عامة، بلا كتابة لقاعدة البيانات.

**عند النجاح:**
```ts
supabaseAdmin
  .from('customers')
  .update({ measurements: validatedMeasurements })
  .eq('measurements_token', token);
```
استبدال كامل لعمود `measurements` (JSONB) — نفس سلوك فورم الموظف الحالي
(`Customers.tsx`'s `onSubmit` يرسل كائن `measurements` كاملاً أيضاً، ليس
دمجاً جزئياً).

**المخرج (200):** `{ "ok": true }`.
**404:** الرمز غير موجود (شكل غير صالح أو غير مطابق).
**429:** تجاوز حد المحاولات.
**400:** حمولة غير صالحة.

## 4) الصفحة العامة

ملف جديد: `src/components/public/CustomerMeasurementsForm.tsx`

- بلا أي استيراد لعميل Supabase من المتصفح — `fetch` فقط لمساري
  `server.ts` أعلاه (نفس قاعدة `OrderTracking.tsx`).
- نفس الهيكل البصري/العلامة التجارية (`customerAppTheme.ts`: ألوان، خط،
  دعم الوضع الداكن تلقائياً) المستخدَم في `OrderTracking.tsx` — بطاقة
  مركزية، شعار المتجر، اسم العميل.
- يعرض **بلا أي تعديل على المكوّنين** `VisualMeasurements` و
  `ThobeMeasurementSelector`، مُهيَّأين بقيم `measurements` القادمة من
  الـ`GET` (تعبئة مسبقة، نفس تجربة "تعديل عميل" عند الموظف) و
  `measurementUnit` القادمة أيضاً من الـ`GET`.
- زر "حفظ" واحد أسفل الفورم → `POST` → حالة نجاح واضحة ("تم حفظ مقاساتك
  بنجاح") تبقى على نفس الصفحة (لا إعادة توجيه) — العميل يقدر يرجع لنفس
  الرابط لاحقاً ويعدّل مجدداً (الرابط دائم).
- حالات التحميل/الخطأ (404 رمز غير صالح، 429 تجاوز محاولات) بنفس أسلوب
  `OrderTracking.tsx`'s `error`/`DeliverySkeleton`.

**التوصيل في `App.tsx`:** مسار عام جديد `/measurements/:token`، بنفس نمط
`TrackRoute` الموجود فعلاً (مكوّن توجيه صغير يستخرج `token` من `useParams`
ويمرّره لمكوّن `React.lazy` محمَّل داخل `React.Suspense`).

## 5) "إرسال الرابط" — في `Customers.tsx`

يُبنى الرابط بنفس الصيغة في كل مكان:
```ts
const measurementsUrl = `${window.location.origin}/measurements/${customer.measurementsToken}`;
```
ويُرسَل عبر `sendWhatsAppMessage(phone, message)` الموجودة فعلاً في
`src/utils/whatsapp.ts` — نفس نمط `sendTrackingLink` في `Orders.tsx`
(`:1594-1609`) تماماً، رسالة عبر `t('customers.measurement_link_message',
{...})` (سلسلة ترجمة ثابتة، بلا قالب قابل للتخصيص — نفس أسلوب
`buildTrackingMessage` لا `buildOrderWhatsAppMessage`).

### أ) نموذج إضافة/تعديل عميل

زر جديد "إرسال رابط المقاسات للعميل" يظهر **فقط عند `editingCustomer` غير
فارغ** (يحتاج `measurementsToken` موجوداً فعلاً، أي العميل محفوظ مسبقاً —
عميل جديد لم يُحفظ بعد ليس له توكِن). يُوضَع بجانب حقل الهاتف أو أسفل
الفورم، يستخدم `customer.phone` المعروض حالياً في الحقل (`watch('phone')`)
لا حاجة لـ`WhatsAppPhoneModal` (الهاتف حقل إجباري على العميل دائماً) —
حارس بسيط (`if (!phone) return`) للحالات النادرة جداً (بيانات قديمة/اختبار
بلا هاتف).

### ب) قائمة/بطاقات العملاء

زر أيقونة واتساب جديد بجانب كل عميل، في كلا العرضين (بطاقات الموبايل حول
`:1238/1255`، وجدول سطح المكتب حول `:1544/1561` — نفس مكان أزرار
Edit2/Trash2 الحالية)، ينفّذ نفس البناء+الإرسال مباشرة بلا فتح نموذج
التعديل.

## الاختبار

- **خادم (Vitest):** دالة التحقق من `body.measurements` — حالات: كائن
  صالح كامل، مفتاح غريب مرفوض، رقم خارج المدى مرفوض، `thobeMeasurements`
  جزئي صالح، enum غير صالح مرفوض، `collarType` نص طويل جداً مرفوض.
  اختبار GET/POST بمحاكاة `supabaseAdmin` (نفس نمط اختبارات
  `authMiddleware.test.ts`/مسارات عامة موجودة إن وُجدت أمثلة مشابهة في
  `server.test.ts`).
- **واجهة (Vitest + RTL إن متاح لمكوّنات مشابهة، وإلا تحقق يدوي بالمتصفح):**
  `CustomerMeasurementsForm` يعرض حالة تحميل، حالة خطأ (404/429)، يعبّئ
  القيم القادمة من GET مسبقاً، يرسل POST عند الحفظ.
- **تحقق يدوي بالمتصفح (staging):**
  1. أضف/عدّل عميلاً، تأكد ظهور زر الإرسال بعد الحفظ، واختبر زر القائمة
     أيضاً.
  2. افتح الرابط الناتج في نافذة متصفح خاصة (محاكاة "بلا تسجيل دخول").
  3. تأكد التعبئة المسبقة الصحيحة، عدّل قيمة، احفظ، تأكد ظهور رسالة
     النجاح.
  4. ارجع لشاشة العميل في لوحة التحكم، تأكد أن `measurements` تحدّثت
     فعلياً.
  5. أعد فتح نفس الرابط مرة أخرى (تحقق الديمومة)، تأكد عرض القيمة
     المحدَّثة لا القديمة.
  6. جرّب توكِن غير صحيح الشكل → رسالة خطأ واضحة بلا كراش.

## خارج النطاق (صراحة)

- **توليد رمز جديد لإبطال رابط قديم** — لا زر "إنشاء رابط جديد" في هذا
  التنفيذ. يمكن إضافته لاحقاً كتعديل بسيط (`UPDATE customers SET
  measurements_token = gen_random_uuid() WHERE id = ...`، مسار واحد
  مُصادَق) إن طُلب.
- **إشعار الموظف عند إرسال العميل للفورم** — لا إشعار/تنبيه داخل لوحة
  التحكم عند حفظ العميل لمقاساته عبر الرابط العام. الموظف يرى التحديث فقط
  عند فتح/تحديث شاشة العميل.
- **قفل الفورم بعد أول إرسال، أو طابور مراجعة** — تم استبعادهما صراحة
  (القرار #1 و#2 أعلاه).
- **تعدّد اللغات في رسالة واتساب** — نفس سلوك `buildTrackingMessage`
  الحالي (نص عربي ثابت عبر `t()`، يتبع لغة واجهة الموظف وقت الإرسال لا
  لغة العميل).
