-- =============================================================================
--  تضييق قراءة saas_settings إلى مفتاح "branding" فقط (اكتُشِف أثناء rls-audit
--  لهذه الجلسة -- خارج نطاق seen-comprehensive-review-fixes-task.md الأصلي،
--  لكن ضمن نفس نوع الفحص الحي الذي طلبته المهمة على الجداول المعدَّلة)
--  ------------------------------------------------------------------------
--  saas_settings_read_any كانت USING (true) لأي مستخدم authenticated --
--  BrandingContext.tsx يحتاج فقط قراءة المفتاح 'branding' (شعار/اسم الشركة،
--  عام بطبيعته)، لكن نفس الجدول يُستخدَم أيضاً كمخزن احتياطي (fallback) لبيانات
--  حسّاسة جداً حين يفشل الجدول المخصَّص: support_sessions (سجل تدقيق الدخول
--  الخفي)، temp_passwords (كلمات مرور مؤقتة لفريق المنصّة في
--  SaaSTeamManagement.tsx)، وطلبات دعم أخرى. أي موظف مصادَق في أي مستأجر
--  كان يقدر يقرأ هذه الصفوف كاملة بمجرد الاستعلام المباشر عن الجدول.
--  الجدول فارغ حالياً على staging (لا صفوف بعد) لكن الثغرة كامنة تنشط بمجرد
--  أول استخدام لأي مسار fallback.
-- =============================================================================

DROP POLICY IF EXISTS saas_settings_read_any ON public.saas_settings;
CREATE POLICY saas_settings_public_read ON public.saas_settings
  FOR SELECT TO authenticated
  USING (app_is_super_admin() OR key = 'branding');
