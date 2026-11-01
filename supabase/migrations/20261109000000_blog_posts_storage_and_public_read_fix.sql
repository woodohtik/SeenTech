-- =============================================================================
--  إصلاحان من مراجعة الفرع الشاملة لنظام المدوَّنة (blog-system):
--
--  1) رفع صورة الغلاف (AdminBlog.tsx -> uploadImageToSupabase(file, 'blog'))
--     يستخدم مسار 'blog/...' على bucket "uploads"، لكن سياسة الإدراج الوحيدة
--     (uploads_scoped_insert من 20260908080000) لا تغطي أي مسار بادئته
--     'blog/' -- فيفشل كل رفع صمتاً ويرجع uploadImageToSupabase تلقائياً
--     لتضمين الصورة Base64 داخل القاعدة بدل رابط Storage حقيقي. هذا التصحيح
--     يضيف فرعاً جديداً للسياسة يسمح بالمسار blog/* فقط لمن يحقق
--     app_is_super_admin() (نفس المستخدمين المسموح لهم بإدارة المدوَّنة في
--     RLS جدول blog_posts).
--
--  2) blog_posts_public_read كانت TO anon فقط، فأي مستخدم مسجَّل دخول بالفعل
--     في التطبيق (تاجر، موظف، أو حتى super_admin يتصفّح عادياً) يحصل على صفر
--     صفوف من /blog و/blog/:slug -- مع أن المدوَّنة تسويقية عامة ويجب أن تُقرأ
--     بصرف النظر عن كون الزائر مسجَّلاً دخول في مكان آخر من التطبيق أم لا.
--     هذا تصحيح للمواصفة (controller ruling) وليس خرقاً لالتزام سابق: نفس
--     USING (status = 'published') يبقى كما هو، فتبقى المقالات غير المنشورة
--     غير مرئية لأي TO غير super_admin.
-- =============================================================================

DROP POLICY IF EXISTS uploads_scoped_insert ON storage.objects;
CREATE POLICY uploads_scoped_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'uploads'
    AND (
      ((storage.foldername(name))[1] = 'tenants'  AND (storage.foldername(name))[2] = public.app_current_tenant_id()::text)
      OR ((storage.foldername(name))[1] = 'products' AND (storage.foldername(name))[2] = public.app_current_tenant_id()::text)
      OR ((storage.foldername(name))[1] = 'logos' AND public.app_current_uid() IS NOT NULL)
      OR ((storage.foldername(name))[1] = 'blog' AND public.app_is_super_admin())
    )
  );

ALTER POLICY blog_posts_public_read ON blog_posts
  TO anon, authenticated;
