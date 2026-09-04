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

## المتبقي (خارج نطاق هذا التنفيذ)

- سيناريو Playwright آلي (المرحلة 5 من ملف المهمة، يحتاج `qa-skills`).
- المراحل 2-4 (إشعارات Push عبر PWA/FCM للعميل والموظف، تغليف PWA وتثبيته)
  لم تُنفَّذ بعد — هذا الملف يوثّق المرحلة 1 فقط (إكمال أساس التتبّع، كانت
  الأولوية القصوى لأنها تصلح ميزة معطّلة فعليًا في الكود).
- **فجوة معروفة، ليست من هذا التنفيذ:** `OrderTracking.tsx`'s `PublicStatus`
  و`STEPS` مبنيان على مفردات حالة "الخياطة الرجالية" فقط (`measurements_taken`,
  `cutting`, `sewing`, `embroidery`, `ironing_packaging`...). المستأجرون من
  قطاعات أخرى (تفعيل القطاعات المتعددة) لهم مفردات `status_key` مختلفة —
  صفحة التتبّع العامة لن تعرض خطوات صحيحة لهم حاليًا (ستقع كلها على الخطوة
  الأولى افتراضيًا). يحتاج تعميم `STEPS` حسب vertical التاجر في مرحلة لاحقة.
