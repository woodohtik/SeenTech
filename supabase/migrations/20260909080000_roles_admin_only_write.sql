-- =============================================================================
--  تقييد إنشاء/تعديل قوالب الأدوار المخصَّصة على owner/admin فقط
--  (اكتُشِف أثناء إصلاح بند role_id/ultra-review -- خارج قائمة النتائج
--  الصريحة لكن من نفس فئة تصعيد الصلاحيات)
--  ------------------------------------------------------------------------
--  حارس role_id الجديد (staff_role_grant_guard) يفحص role_key المستهدَف
--  بالاسم (owner/admin/platform) فقط. لكن roles_tenant_insert/update كانتا
--  تسمحان لأي موظف بالمستأجر (بلا فحص دور الفاعل) بإنشاء صف roles مخصَّص
--  جديد باسم بريء (مثلاً "cashier_plus") لكن بصلاحيات permissions كاملة،
--  ثم تعيين role_id الخاص بصفّه هو لهذا الصف -- تصعيد كامل يتجاوز الحارس
--  الذي يفحص الاسم لا محتوى الصلاحيات فعلياً.
--  الحل: قصر إنشاء/تعديل أي قالب دور (tenant_id IS NOT NULL أيضاً، ليس فقط
--  tenant_id IS NULL كما في بند 2.3) على owner/admin/super_admin فعلياً.
-- =============================================================================

DROP POLICY IF EXISTS roles_tenant_insert ON public.roles;
CREATE POLICY roles_tenant_insert ON public.roles
  FOR INSERT TO authenticated
  WITH CHECK (
    app_is_super_admin()
    OR (tenant_id = app_current_tenant_id() AND app_current_role() IN ('owner', 'admin'))
  );

DROP POLICY IF EXISTS roles_tenant_update ON public.roles;
CREATE POLICY roles_tenant_update ON public.roles
  FOR UPDATE TO authenticated
  USING (
    app_is_super_admin()
    OR (tenant_id = app_current_tenant_id() AND app_current_role() IN ('owner', 'admin'))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (tenant_id = app_current_tenant_id() AND app_current_role() IN ('owner', 'admin'))
  );
