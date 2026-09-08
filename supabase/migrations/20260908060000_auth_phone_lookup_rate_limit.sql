-- =============================================================================
--  بحث الجوال قبل تسجيل الدخول -- خادمي ومحدود المعدّل بدل استعلام عميل مباشر
--  (seen-comprehensive-review-fixes-task.md، بند 3، Login.tsx ~301-323)
--  ------------------------------------------------------------------------
--  فحص حي لسياسات RLS على staff/tailor_requests (هذه الجلسة) أكّد أن كلا
--  الجدولين يمنعان القراءة غير المُصادَق عليها تماماً (staff_tenant_read/
--  tailor_requests_self كلاهما يشترطان app_current_uid() غير NULL) --
--  فاستعلام Login.tsx المباشر (.from('staff').select('email').eq('phone',
--  ...)) قبل تسجيل الدخول كان يفشل صمتاً (RLS تُرجع صفراً صفوف دائماً) ولا
--  يعمل تسجيل الدخول بالجوال إطلاقاً حالياً، بغضّ النظر عن صحة الرقم.
--  هذا الجدول + الدالة يُمكِّنان بحثاً خادمياً واحداً (عبر supabaseAdmin،
--  يتجاوز RLS عمداً وبأمان) بمعدّل محدود لمنع حصر أرقام الجوال، على نفس
--  نمط tracking_attempts/print_pair_attempts المستخدَم بالفعل.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.auth_phone_lookup_attempts (
  ip        text PRIMARY KEY,
  count     integer NOT NULL DEFAULT 1,
  reset_at  timestamptz NOT NULL
);

ALTER TABLE public.auth_phone_lookup_attempts ENABLE ROW LEVEL SECURITY;
-- عمداً بلا أي سياسة: الوصول حصراً عبر supabaseAdmin (service_role) من
-- السيرفر، الذي يتجاوز RLS أصلاً.

CREATE OR REPLACE FUNCTION public.increment_auth_phone_lookup_attempt(p_ip text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO auth_phone_lookup_attempts (ip, count, reset_at)
  VALUES (p_ip, 1, now() + interval '60 seconds')
  ON CONFLICT (ip) DO UPDATE SET
    count = CASE WHEN auth_phone_lookup_attempts.reset_at > now() THEN auth_phone_lookup_attempts.count + 1 ELSE 1 END,
    reset_at = CASE WHEN auth_phone_lookup_attempts.reset_at > now() THEN auth_phone_lookup_attempts.reset_at ELSE now() + interval '60 seconds' END
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.increment_auth_phone_lookup_attempt(text) FROM PUBLIC;
