-- =============================================================================
--  سحب EXECUTE عن anon/authenticated من دوال يُفترض أنها للخادم فقط
--  (ultra-review، بند PLAUSIBLE تحقّق حي أثبت أنه CONFIRMED)
--  ------------------------------------------------------------------------
--  REVOKE ALL ... FROM PUBLIC (النمط المستخدَم في كل هذه الدوال، بما فيها
--  increment_print_pair_attempt/increment_tracking_attempt القديمتان) لا
--  يسحب صلاحيات EXECUTE الافتراضية التي يمنحها Supabase تلقائياً لكل من
--  anon وauthenticated عند إنشاء دالة جديدة في public -- PUBLIC هنا pseudo-
--  role منفصل تماماً عن هذين. فحص حي (information_schema.routine_privileges،
--  هذه الجلسة) أكّد أن كل الدوال أدناه قابلة للاستدعاء المباشر حالياً عبر
--  supabase.rpc(...) من أي مستخدم مصادَق (بل ومن anon أيضاً لبعضها) --
--  الأخطر: reset_pin_verify_attempts قابلة للاستدعاء المباشر بأي p_key
--  (tenantId:uid) يعرفه المهاجم عن نفسه، فيصفّر قفل محاولات PIN الخاص به
--  ويتابع تخمين رمز زميله بلا أي حد إطلاقاً -- يُبطل كل إصلاح 3.9 فعلياً.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.reset_pin_verify_attempts(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_pin_verify_failure(text, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_print_pair_attempt(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_tracking_attempt(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_auth_phone_lookup_attempt(text) FROM anon, authenticated;

-- staff_ids_with_pin_set/increment_supplier_balance/approve_subscription_request/
-- reject_subscription_request مُصمَّمة عمداً لتُستدعى مباشرة من العميل
-- (authenticated فقط) -- كلها تتحقق داخلياً من app_current_tenant_id()/
-- app_is_super_admin() فلا تحتاج anon إطلاقاً؛ سحبها منه دفاع إضافي فقط.
REVOKE EXECUTE ON FUNCTION public.staff_ids_with_pin_set(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_supplier_balance(uuid, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_subscription_request(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reject_subscription_request(uuid, text) FROM anon;
