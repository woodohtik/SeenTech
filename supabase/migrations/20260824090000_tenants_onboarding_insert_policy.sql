-- =============================================================================
--  إصلاح حرج: لا توجد أي سياسة INSERT على جدول tenants لمستخدم عادي عند
--  التسجيل الذاتي (self-signup) على production — كانت هذه السياسة موجودة
--  فقط على staging (طُبِّقت يدوياً هناك عبر scripts/legacy-oneoff/fix-rls.sql
--  ولم تُطبَّق على production قط، وهي ليست مسجَّلة كـ migration متتبَّعة).
--
--  الأثر الفعلي: كل تسجيل حساب جديد على production كان يفشل بصمت عند خطوة
--  إنشاء المتجر (tenants insert) برسالة "new row violates row-level security
--  policy for table tenants" — يتم إنشاء صف auth.users و users بنجاح، لكن
--  لا tenant ولا branch ولا staff ولا tailor_requests، فيظهر للمستخدم خطأ
--  "لم يكتمل إعداد المتجر" (أو الآن بعد إصلاح التوجيه: يُرسَل لصفحة التهيئة
--  التي تفشل بدورها لأن جلب المتجر يعيد لا شيء). ثُبت هذا مباشرة عبر تسجيل
--  حساب اختباري حقيقي على production.
--
--  هذه المصدر الوحيد الحقيقي لهذه السياسة الآن — لن تُطبَّق يدوياً بعد اليوم.
-- =============================================================================

DROP POLICY IF EXISTS "tenants_onboarding_insert" ON tenants;
CREATE POLICY "tenants_onboarding_insert" ON tenants
    FOR INSERT WITH CHECK (owner_uid = app_current_uid() OR app_is_super_admin());

-- سياسات قراءة إضافية موجودة على staging منذ فترة (نفس fix-rls.sql) وغائبة
-- عن production — لا تُغيّر شيئاً وظيفياً (تتداخل مع tenants_read/staff_tenant_read
-- الموجودتين أصلاً على الاثنين) لكن تُضاف هنا لإغلاق الفارق نهائياً ومنع أي
-- مفاجأة مستقبلية بينهما.
DROP POLICY IF EXISTS "tenants_read_own" ON tenants;
CREATE POLICY "tenants_read_own" ON tenants
    FOR SELECT USING (
        app_is_super_admin()
        OR owner_uid = app_current_uid()
        OR id = app_current_tenant_id()
    );

DROP POLICY IF EXISTS "staff_read_own" ON staff;
CREATE POLICY "staff_read_own" ON staff
    FOR SELECT USING (uid = app_current_uid() OR (tenant_id = app_current_tenant_id()));
