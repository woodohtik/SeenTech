# مواصفة تتبّع الطلب العام (Public Order Tracking)

**الحالة:** المرحلة 1 من `seen-companion-app-task_1.md` — منفَّذة.
**آخر تحديث:** 2026-09-04

## الهدف

يفتح العميل النهائي رابطًا عامًا (بلا تسجيل دخول، بلا حساب) يعرض حالة طلبه
الحالية باسم ومتجر «سين» — growth loop: المحل يرسل الرابط عبر واتساب، العميل
يرى العلامة، المحل يلتقط وعيًا مجانيًا بالعلامة.

## القرار المعماري — لماذا ليس RPC + RLS مباشر من المتصفح

المكوّن `src/components/public/OrderTracking.tsx` كُتب أصلاً بافتراض استدعاء
`supabase.rpc('get_public_order_tracking', ...)` مباشرة من المتصفح، محميًا
بـ `SECURITY DEFINER` + `GRANT` لـ `anon` فقط على تلك الدالة. **غُيِّر هذا
القرار عند التنفيذ** لسببين:

1. **تحديد المعدّل (rate limiting) يحتاج IP حقيقي موثوق.** طلب مباشر من
   `anon` عبر PostgREST يمرّ غالبًا عبر مجمِّع اتصالات (connection pooler)،
   فلا يمكن الوثوق بـ `inet_client_addr()` داخل Postgres لتمثيل IP العميل
   الفعلي بشكل موثوق. أما مسار خادم (`server.ts` عبر Express على Vercel)
   فيملك `req.headers['x-forwarded-for']` موثوقًا (نفس النمط المستخدم فعلاً
   في `src/server/printRelay.ts` لتحديد معدّل محاولات الاقتران).
2. **توحيد النمط مع سابقة موجودة فعلاً في هذا المشروع.** `GET
   /api/public/invoices/:id` في `server.ts` يخدم بيانات عامة بلا مصادقة
   بنفس الطريقة تمامًا: `supabaseAdmin` (يتجاوز RLS) + اختيار الحقول
   المسموحة يدويًا فقط، بلا RPC. هذا يعطي طبقتي دفاع (Express rate limit +
   اختيار حقول صريح) بدل الاعتماد على RLS/GRANT وحدها.

**النتيجة:** لا توجد دالة `get_public_order_tracking` في قاعدة البيانات
إطلاقًا، ولا أي `GRANT` لـ `anon`. القراءة العامة تمر حصرًا عبر:

```
GET /api/public/order-tracking/:token
```

في `server.ts`، باستخدام `supabaseAdmin` (مفتاح `service_role`، يتجاوز RLS).

## عمود tracking_token

`supabase/migrations/20260903000000_orders_public_tracking.sql`:

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_token UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_tracking_token ON orders (tracking_token);
```

- **عشوائي بالكامل** (UUID v4، ~122 بت إنتروبيا) — غير مشتق من
  `order_number` التسلسلي القابل للتخمين، ومنفصل عن `orders.id` (لا يكشف
  الرابط العام معرّف الصف الداخلي).
- `DEFAULT gen_random_uuid()` يولّده تلقائيًا لكل طلب جديد **بلا أي تعديل**
  على منطق الإنشاء في التطبيق (`Orders.tsx`, `POS.tsx`, إلخ) — لا trigger
  منفصل مطلوب.
- الطلبات الموجودة مسبقًا حصلت على توكِن عشوائي فريد لكل صف تلقائيًا عند
  تطبيق الـ migration (Postgres يعيد كتابة كل صف لأن `gen_random_uuid()`
  دالة volatile).

## GET /api/public/order-tracking/:token

**المدخل:** `token` (يجب أن يطابق شكل UUID — أي شيء آخر يُرفض فورًا بـ 404
بلا استعلام قاعدة بيانات، توفيرًا للحصة على تخمينات واضحة البطلان).

**المخرج (200):**
```json
{
  "order_number": 10482,
  "status": "sewing",
  "shop_name": "خياطة الأناقة",
  "shop_logo_url": "https://...",
  "delivery_date": "2026-09-10T00:00:00Z"
}
```

لا شيء آخر من صف `orders` أو `tenants` يُرجَع — لا `customer_name`، لا
`total_amount`، لا `notes`، لا أي معرّف داخلي. `status` يفضّل `status_key`
(الحقل الحر متعدد القطاعات من عمل تفعيل القطاعات) على `status` (enum
الخياطة الرجالية القديم) إن وُجد، بنفس أولوية `Orders.tsx`.

**404:** لا يوجد طلب بهذا التوكِن (أو شكل التوكِن غير صالح أصلاً).
**429:** تجاوز حد المحاولات لعنوان IP هذا (انظر أدناه).

### تحديد المعدّل (Rate Limiting)

جدول `tracking_attempts` (نفس نمط `print_pair_attempts` في
`20260824000000_print_relay_persistent_store.sql` — الوصول حصرًا عبر
`service_role`، RLS مفعّل بلا أي سياسة):

- **20 محاولة فاشلة لكل IP كل دقيقة.** العدّاد يزيد **فقط عند عدم إيجاد
  طلب** — عميل شرعي يعيد تحميل صفحة تتبّعه الصحيحة لا يُعاقَب أبدًا، فقط من
  يخمّن توكِنات عشوائية متكررة.
- عند التجاوز: `429` مع رسالة "محاولات كثيرة جداً. انتظر دقيقة ثم أعد
  المحاولة."

## الواجهة

`src/components/public/OrderTracking.tsx` (مسار `/track/:token` في
`App.tsx`، بلا مصادقة) تستدعي `fetch('/api/public/order-tracking/' +
token)` — لا استيراد لعميل Supabase إطلاقًا في هذا المكوّن.

`src/components/Orders.tsx`: زر "إرسال رابط التتبّع" بجانب كل طلب (لوحة
التفاصيل) يبني `${window.location.origin}/track/${order.trackingToken}`
ويرسله عبر **نفس نمط `src/utils/whatsapp.ts`** الموجود مسبقًا (لا مكتبة
جديدة، لا آلية إرسال جديدة) — يفتح واتساب مباشرة إن كان رقم العميل معروفًا،
وإلا يطلبه أولاً عبر نفس `WhatsAppPhoneModal` المستخدم لرابط الفاتورة.

## اختبار (TDD) — معايير القبول المتحقَّقة يدويًا

- [x] توكِن غير صحيح الشكل (ليس UUID) → 404 فورًا، بلا استعلام قاعدة بيانات.
- [x] توكِن UUID صحيح الشكل لكن غير موجود → 404، يزيد عدّاد IP.
- [x] توكِن صحيح وموجود → البيانات المسموحة فقط، عدّاد IP لا يتأثر.
- [x] تجاوز 20 محاولة فاشلة خلال دقيقة لنفس IP → 429، حظر مؤقت.
- [ ] اختبار Vitest/Playwright آلي — **لم يُضَف بعد**، انظر "المتبقي" أدناه.

## المرحلة 2 — إشعارات Push للعميل (PWA/FCM)

**الحالة:** منفَّذة بالكود بالكامل، لكن **لا تعمل فعليًا حتى يُضاف مفتاح
VAPID** (خطوة واحدة يدوية خارج قدرتي — انظر أدناه).

### القرار المعماري — من يُطلق الإشعار؟

خلافًا لما افترضه القسم الأول من ملف المهمة (webhook على مستوى قاعدة
البيانات يكتشف تغيّر الحالة تلقائيًا)، **لا توجد آلية تحديث حالة طلب واحدة
مركزية على الخادم** — تحديث الحالة يحدث حاليًا بـ 3 أماكن منفصلة في
الواجهة، وكلها تكتب مباشرة إلى Supabase من المتصفح (`Orders.tsx` دالتا
`updateStatus`/`confirmDelivery`، و`DashboardToday.tsx` دالة `advance`)،
بلا أي مسار خادم موحّد يمر به كل تحديث.

فحصت خيار trigger على مستوى قاعدة البيانات (امتداد `pg_net` لاستدعاء HTTP
من Postgres عند UPDATE على `orders`) — **`pg_net` غير مفعّل على مشروع
Supabase الحالي**، وتفعيله + بناء trigger موثوق بلا اختبار مباشر أمر أعقد
وأخطر مما يستحقه النطاق الحالي.

**القرار الفعلي المطبَّق** (يطابق تعليمة المرحلة 2 البند 4 حرفيًا: "لا تلمس
منطق تحديث الحالة الحالي — فقط أضف استدعاء إرسال إشعار بعده"):
`src/utils/orderNotify.ts`'s `notifyOrderStatusChange(orderId)` — استدعاء
واحد سطر يُضاف بعد نجاح كل من الأماكن الثلاثة، يستدعي
`POST /api/orders/:id/notify-status` (مصادَق، `authenticate` middleware).
هذا المسار (وليس المتصفح) هو من **يُرسل** فعليًا عبر `firebase-admin`
(بيانات الاعتماد لا تصل المتصفح أبدًا) — العميل فقط يُطلق الطلب بعد نجاح
تحديثه، لا يلمس FCM إطلاقًا. فشل هذا الاستدعاء (شبكة، لا اشتراك، FCM معطّل)
مغلَّف بـ `try/catch` منفصل في `orderNotify.ts` ولا يصل أبدًا لمنطق تحديث
الحالة نفسه أو يُظهر خطأ للموظف.

### جدول order_push_subscriptions

`supabase/migrations/20260904000000_order_push_subscriptions.sql` —
`(tracking_token, fcm_token)` فقط، بلا أي معرّف مستخدم (العميل بلا حساب).
نفس نمط `tracking_attempts`: `service_role` فقط، RLS بلا سياسات.

### التسجيل (العميل)

`src/lib/pushNotifications.ts` — `subscribeToOrderNotifications(token)`:
يطلب إذن الإشعار من المتصفح، يسجّل `public/firebase-messaging-sw.js`
(service worker منفصل عن SW الخاص بـ vite-plugin-pwa، لتفادي ربط توصيل FCM
بدورة تحديث/تخزين مؤقت ذلك الـ SW)، يجلب توكِن FCM عبر `getToken()`،
ويرسله لـ `POST /api/public/order-tracking/:token/subscribe` (بلا مصادقة،
بنفس تحديد المعدّل المشترك مع مسار GET أعلاه عبر `checkTrackingRateLimit`).

`firebase-messaging-sw.js` ملف ثابت (لا وصول لمتغيرات بيئة Vite وقت
البناء)، فتُمرَّر إعدادات Firebase (غير سرّية — موجودة أصلاً بحزمة JS
الرئيسية) عبر query string عند التسجيل بدل خطوة بناء إضافية.

### الإرسال (السيرفر)

`POST /api/orders/:id/notify-status` في `server.ts`: يتحقق أن الطلب يخص
tenant المستدعي، يجلب `order_push_subscriptions` بـ `tracking_token`
الطلب، يرسل عبر `adminMessaging.send()` (يُضاف بـ
`src/server/firebase-admin.ts`، يعيد استخدام نفس `FIREBASE_SERVICE_ACCOUNT`
المُعدّ أصلاً لـ `adminAuth` — **لا سرّ خادم جديد مطلوب**)، وينظّف توكِنات
FCM المُلغاة (`messaging/registration-token-not-registered`) من الجدول.

### PWA (تثبيت + أيقونة)

`vite-plugin-pwa` مُضاف بـ `vite.config.ts`، أيقونة `public/Logo.svg`
الموجودة (وفق تعليمة المهمة صراحةً) — **علمًا أنها شعار مستطيل (1502×453)
وليست أيقونة مربّعة مخصّصة**؛ ستظهر بشكل مُصغَّر/محاط بحواف داخل شكل
الأيقونة المربّع القياسي، تمامًا كما تظهر اليوم كـ favicon بالفعل. لا توجد
أيقونة PNG مربّعة بالمشروع لبناء `apple-touch-icon` سليم على iOS — أُضيف
رابط `apple-touch-icon` يشير لنفس ملف SVG كخطوة أولى، لكن iOS Safari قد
يتجاهله (يحتاج PNG مربّع حقيقي لتجربة تثبيت مثالية على iOS تحديدًا). هذا
تحسين بصري مؤجَّل، ليس عائقًا وظيفيًا.

### ⚠️ خطوة مطلوبة منك قبل أن تعمل الإشعارات فعليًا

1. **Firebase Console → إعدادات المشروع → Cloud Messaging → Web Push
   certificates → Generate key pair.** ينتج "مفتاح VAPID" — نسخة نصية
   واحدة. لم أقدر أفعل هذا آليًا (يحتاج تفاعل مباشر مع لوحة Firebase؛
   Firebase CLI بهذه البيئة لا يستجيب/يتوقف عند تسجيل الدخول).
2. أضفه كمتغيّر بيئة Vercel باسم `VITE_FIREBASE_VAPID_KEY` (على staging على
   الأقل، production لاحقًا).
3. لا حاجة لأي إعداد خادم إضافي — `FIREBASE_SERVICE_ACCOUNT` الموجود أصلاً
   كافٍ لإرسال FCM.

بلا هذا المفتاح: زر "فعّل إشعارات حالة الطلب" يظهر ويُضغَط بلا أي خطأ ظاهر
للعميل، لكن `subscribeToOrderNotifications` يتوقف عند `notify_unavailable`/
`error` بصمت (مُسجَّل بـ `console.error` فقط) — سلوك آمن (fail closed)، لا
عطل مرئي، فقط الميزة لا تعمل.

## المتبقي (خارج نطاق هذا التنفيذ)

- سيناريو Playwright آلي (المرحلة 5 من ملف المهمة، يحتاج `qa-skills`).
- المرحلة 3 (لوحة "طلبات جديدة" + إشعارات للموظف) والمرحلة 4 (اختبار تثبيت
  PWA فعلي على جهاز حقيقي) لم تُنفَّذا بعد.
- إشعارات Push المرسلة نصّها عربي ثابت فقط (`server.ts`'s
  `ORDER_STATUS_LABELS_AR`) — لا يتبع لغة العميل المفضّلة (لا آلية لمعرفتها
  من اشتراك بلا حساب)، ومبني فقط على مفردات "الخياطة الرجالية" (نفس فجوة
  `STEPS` أدناه).
- **فجوة معروفة، ليست من هذا التنفيذ:** `OrderTracking.tsx`'s `PublicStatus`
  و`STEPS` مبنيان على مفردات حالة "الخياطة الرجالية" فقط (`measurements_taken`,
  `cutting`, `sewing`, `embroidery`, `ironing_packaging`...). المستأجرون من
  قطاعات أخرى (تفعيل القطاعات المتعددة) لهم مفردات `status_key` مختلفة —
  صفحة التتبّع العامة لن تعرض خطوات صحيحة لهم حاليًا (ستقع كلها على الخطوة
  الأولى افتراضيًا). يحتاج تعميم `STEPS` حسب vertical التاجر في مرحلة لاحقة.
