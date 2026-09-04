-- =============================================================================
--  اشتراكات إشعارات Push لتتبّع الطلب العام (المرحلة 2 من
--  seen-companion-app-task_1.md)
--  ------------------------------------------------------------------------
--  العميل يفعّل الإشعارات من صفحة /track/:token العامة نفسها -- بلا حساب
--  وبلا هوية مستخدم إطلاقاً -- فالاشتراك مربوط بـ tracking_token (نفس
--  الرمز العشوائي غير القابل للتخمين المستخدم للقراءة العامة في
--  20260903000000_orders_public_tracking.sql)، وليس بأي معرّف مستخدم.
--
--  الوصول حصراً عبر service_role من السيرفر (POST
--  /api/public/order-tracking/:token/subscribe للتسجيل، وGET
--  /api/orders/:id/notify-status للإرسال) -- بنفس نمط tracking_attempts /
--  print_pair_attempts: RLS مفعّل بلا أي سياسة ممنوحة لـ anon/authenticated.
-- =============================================================================

CREATE TABLE IF NOT EXISTS order_push_subscriptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_token uuid NOT NULL,
  fcm_token      text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_push_subscriptions_tracking_token
  ON order_push_subscriptions (tracking_token);

-- إعادة تفعيل الإشعار على نفس الجهاز يحدّث updated_at بدل مضاعفة الصفوف.
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_push_subscriptions_token
  ON order_push_subscriptions (tracking_token, fcm_token);

ALTER TABLE order_push_subscriptions ENABLE ROW LEVEL SECURITY;
-- عمداً بلا أي سياسة: الوصول حصراً عبر مفتاح service_role من السيرفر.
