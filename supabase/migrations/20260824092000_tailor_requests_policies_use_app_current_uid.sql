-- =============================================================================
--  نفس فئة الخلل (رابع اكتشاف من نفس الجذر): tailor_requests_self (SELECT) و
--  tailor_requests_update (UPDATE) على production كانتا لا تزالان تستخدمان
--  current_setting('app.current_uid', true) المباشر بدل دالة app_current_uid()
--  -- متغيّر جلسة Firebase القديم الذي لم يعد يُضبَط أبداً بعد التحوّل
--  لمصادقة Supabase. staging مُصلَحة أصلاً؛ هذه المهاجرة تُطابق production معها.
--
--  الأثر: تحديث tailor_requests.onboarding_step=4 في نهاية التهيئة (لتمييز
--  اكتمالها بشكل دائم) كان يفشل صامتاً (0 صفوف مُحدَّثة، بلا خطأ ظاهر لأنه
--  مُغلَّف بـ try/catch منفصل في Onboarding.tsx) — غير حرج بمفرده، لكنه يعني
--  أن onboarding_step يبقى عالقاً على القيمة القديمة في قاعدة البيانات حتى
--  لو نجحت بقية خطوات التهيئة.
-- =============================================================================

DROP POLICY IF EXISTS tailor_requests_self ON tailor_requests;
CREATE POLICY tailor_requests_self ON tailor_requests
    FOR SELECT USING (app_is_super_admin() OR uid = app_current_uid());

DROP POLICY IF EXISTS tailor_requests_update ON tailor_requests;
CREATE POLICY tailor_requests_update ON tailor_requests
    FOR UPDATE USING (app_is_super_admin() OR uid = app_current_uid())
    WITH CHECK (app_is_super_admin() OR uid = app_current_uid());
