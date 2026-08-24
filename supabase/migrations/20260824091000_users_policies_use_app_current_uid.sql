-- =============================================================================
--  إصلاح حرج ثانٍ من نفس الفصيلة: سياسات users_self_read/users_self_write على
--  production كانت لا تزال تستخدم current_setting('app.current_uid', true)
--  مباشرة -- متغيّر جلسة Postgres خاص بنظام Firebase القديم كان يُضبَط يدوياً
--  قبل كل استعلام عبر الخادم القديم، ولم يعد يُضبَط أبداً بعد التحوّل لمصادقة
--  Supabase (migration 20260815090000). النتيجة: هذا المتغيّر فارغ دائماً في
--  أي طلب REST عادي، فتفشل السياسة دائماً كأن المستخدم ليس هو صاحب الصف.
--  users_super_admin_write (INSERT) كانت تقرأ request.jwt.claims مباشرة (تعمل
--  بالصدفة) لكن بلا مسار super_admin، بخلاف staging المُصلَحة فعلاً.
--
--  الأثر الفعلي المكتشف: خطوة "إتمام الإعداد" في التهيئة تستدعي
--  supabase.from('users').upsert(...) لأول عملية فيها -- إن كان صف users
--  موجوداً أصلاً (وهو كذلك دائماً، يُنشأ عند التسجيل) يسلك upsert مسار UPDATE
--  عبر ON CONFLICT، الذي تحكمه users_self_write المعطوبة -- فيفشل بـ
--  "new row violates row-level security policy for table users" لكل مستخدم
--  يحاول إنهاء التهيئة على production. ثُبت هذا مباشرة عبر استدعاء upsert
--  حقيقي بنفس شكل استدعاء Onboarding.tsx.
--
--  staging لديها النسخة الصحيحة أصلاً (تستخدم app_current_uid() في الكل) —
--  هذه المهاجرة تُطابق production معها تماماً.
-- =============================================================================

DROP POLICY IF EXISTS "users_super_admin_write" ON users;
CREATE POLICY "users_super_admin_write" ON users
    FOR INSERT WITH CHECK (id = app_current_uid() OR app_is_super_admin());

DROP POLICY IF EXISTS users_self_read ON users;
CREATE POLICY users_self_read ON users
    FOR SELECT USING (app_is_super_admin() OR id = app_current_uid());

DROP POLICY IF EXISTS users_self_write ON users;
CREATE POLICY users_self_write ON users
    FOR UPDATE USING (app_is_super_admin() OR id = app_current_uid())
    WITH CHECK (app_is_super_admin() OR id = app_current_uid());
