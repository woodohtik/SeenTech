-- =============================================================================
--  إصلاح فعلي لـ REVOKE دوال دورة حياة التجربة/الاشتراك (B-4، security-fix-
--  tasklist.md) -- الإصلاح السابق (20260822090300) وقع في نفس الخطأ الذي
--  اكتشفته هذه الجلسة اليوم بالفحص الحي: REVOKE ALL ... FROM PUBLIC لا يسحب
--  صلاحيات EXECUTE الافتراضية التي يمنحها Supabase تلقائياً لـanon/
--  authenticated (PUBLIC pseudo-role منفصل تماماً عنهما). فحص حي
--  (information_schema.routine_privileges، هذه الجلسة) أكّد أن الخمسة كلها
--  ما زالت قابلة للاستدعاء المباشر من anon وauthenticated معاً رغم
--  REVOKE ALL FROM PUBLIC.
--
--  الخطر الفعلي محدود حالياً بفضل RLS/trigger على tenants (tenants_owner_update
--  + tenants_no_self_billing_escalation_trigger من هذه الجلسة نفسها) اللذين
--  يمنعان أي تعديل غير مصرَّح لـsubscription_status/is_trial/locked_at/
--  purge_at حتى لو نجح استدعاء الدالة -- لكن الاعتماد على تفاعل معقّد بين
--  RLS عبر عدة جداول (trial_purge_sweep يحذف من orders/customers/
--  inventory_items/staff/branches) بدل قطع الوصول عند مصدره أضعف بكثير من
--  REVOKE EXECUTE مباشرة. نفس الدرس المطبَّق على دوال هذه الجلسة (rate
--  limiters) يُطبَّق هنا الآن بنفس الطريقة الصحيحة.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.activate_tenant_subscription(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.start_tenant_trial(uuid, int) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trial_lock_sweep() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trial_purge_sweep() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.slg_sweep() FROM anon, authenticated;

-- start_tenant_trial يُستدعى فعلياً من العميل عند التسجيل
-- (trialService.ts startTrial()) لمنح تجربة الـ14 يوماً -- يبقى يعمل.
GRANT EXECUTE ON FUNCTION public.start_tenant_trial(uuid, int) TO authenticated;
