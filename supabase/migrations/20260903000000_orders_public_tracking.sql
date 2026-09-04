-- =============================================================================
--  رمز تتبّع عام لكل طلب + تحديد معدّل استعلامات التتبّع العامة
--  ------------------------------------------------------------------------
--  src/components/public/OrderTracking.tsx (المسار العام /track/:token) كان
--  موجوداً في الكود لكن معطّلاً فعلياً: لا عمود tracking_token على orders،
--  ولا أي آلية خلفية تخدمه. راجع seen-companion-app-task_1.md المرحلة 1.
--
--  tracking_token عشوائي (UUID v4، ~122 بت إنتروبيا) — غير مشتق من
--  order_number التسلسلي القابل للتخمين بسهولة، ومنفصل عن orders.id (لا
--  نريد أن يكشف رابط التتبّع العام معرّف الصف الداخلي). DEFAULT
--  gen_random_uuid() يولّده تلقائياً لكل طلب جديد بلا أي تعديل على منطق
--  الإنشاء في التطبيق.
--
--  القراءة العامة تمر حصراً عبر GET /api/public/order-tracking/:token في
--  server.ts (supabaseAdmin، يختار الحقول المسموحة فقط) -- بنفس نمط
--  /api/public/invoices/:id الموجود مسبقاً -- وليس عبر RPC/RLS مباشر من
--  المتصفح، تجنّباً للاعتماد على رؤية IP الحقيقي للعميل داخل Postgres خلف
--  مجمّع الاتصالات (انظر PUBLIC_TRACKING_SPEC.md).
--
--  tracking_attempts يحدّد معدّل محاولات التخمين لكل IP، بنفس نمط
--  print_pair_attempts في 20260824000000_print_relay_persistent_store.sql:
--  الوصول حصراً عبر service_role من السيرفر، RLS مفعّل بلا أي سياسة ممنوحة.
--
--  تنبيه لمن يطبّق هذه الهجرة على قاعدة إنتاج بها بيانات فعلية: DEFAULT
--  gen_random_uuid() قيمة "متطايرة" (volatile) فتُجبر Postgres على إعادة
--  كتابة جدول orders كاملاً (قفل ACCESS EXCLUSIVE طوال العملية) بدل المسار
--  السريع الذي يستخدمه Postgres للقيم الثابتة -- وبناء الفهرس الفريد بعدها
--  غير CONCURRENT فيضيف قفلاً آخر. على جدول orders كبير هذا يعني توقفاً
--  ملحوظاً لكل القراءة/الكتابة أثناء النشر. بيئة staging الحالية صغيرة بما
--  يكفي ليمر هذا بلا أثر ملحوظ؛ على إنتاج بحجم أكبر يُفضَّل تنفيذها يدوياً
--  خارج ساعات الذروة، أو تعويض عمود ثابت + تحديث الصفوف على دفعات + فهرس
--  CONCURRENTLY منفصل.
-- =============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_token UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_tracking_token ON orders (tracking_token);

CREATE TABLE IF NOT EXISTS tracking_attempts (
  ip        text PRIMARY KEY,
  count     integer NOT NULL DEFAULT 1,
  reset_at  timestamptz NOT NULL
);

ALTER TABLE tracking_attempts ENABLE ROW LEVEL SECURITY;
-- عمداً بلا أي سياسة: الوصول حصراً عبر مفتاح service_role من السيرفر.
