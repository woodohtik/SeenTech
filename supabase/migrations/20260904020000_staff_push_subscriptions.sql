-- =============================================================================
--  اشتراكات إشعارات Push للموظف عند وصول طلب جديد (المرحلة 3 من
--  seen-companion-app-task_1.md)
--  ------------------------------------------------------------------------
--  خلافاً لـ order_push_subscriptions (مربوطة بـ tracking_token، العميل
--  بلا حساب) -- هذا الجدول مربوط بـ staff_id لأن الموظف له حساب فعلي
--  ومصادق عليه. الوصول حصراً عبر service_role من السيرفر (نفس نمط باقي
--  جداول الإشعارات هذه المهمة): POST /api/staff/push-subscribe للتسجيل
--  (authenticate middleware، staff_id من req.user وليس من جسم الطلب)،
--  وPOST /api/orders/:id/notify-new-order للإرسال.
-- =============================================================================

CREATE TABLE IF NOT EXISTS staff_push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   uuid NOT NULL,
  fcm_token  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_push_subscriptions_staff_id
  ON staff_push_subscriptions (staff_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_push_subscriptions_token
  ON staff_push_subscriptions (staff_id, fcm_token);

ALTER TABLE staff_push_subscriptions ENABLE ROW LEVEL SECURITY;
-- عمداً بلا أي سياسة: الوصول حصراً عبر مفتاح service_role من السيرفر.
