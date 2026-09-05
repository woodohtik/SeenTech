-- =============================================================================
--  FORCE ROW LEVEL SECURITY على جدولي اشتراكات Push (seen-companion-app-android-task.md,
--  Phase أ6/ب6 -- بند المراجعة الأمنية)
--  ------------------------------------------------------------------------
--  ENABLE ROW LEVEL SECURITY وحده لا يقيّد مالك الجدول (role الذي أنشأه) --
--  فقط الأدوار الأخرى (anon/authenticated). service_role يتجاوز RLS أصلاً
--  عبر صلاحية BYPASSRLS الخاصة به بغض النظر عن FORCE، فهذا التغيير لا يمسّ
--  مسار السيرفر الحالي إطلاقاً -- إنه تحصين دفاعي إضافي (defense-in-depth)
--  يمنع حتى مالك الجدول نفسه من القراءة/الكتابة دون سياسة صريحة، تماشياً مع
--  التعليق الأصلي في كل من الملفين: "الوصول حصراً عبر service_role".
-- =============================================================================

ALTER TABLE order_push_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_push_subscriptions FORCE ROW LEVEL SECURITY;
