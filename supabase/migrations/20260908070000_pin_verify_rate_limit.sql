-- =============================================================================
--  نقل محدِّد محاولات PIN من Map في الذاكرة إلى جدول قاعدة بيانات
--  (seen-comprehensive-review-fixes-task.md، بند 3، server.ts verifyPinAttempts)
--  ------------------------------------------------------------------------
--  verifyPinAttempts كان Map<string,...> داخل عملية Node واحدة -- على Vercel
--  Functions كل طلب قد يصل نسخة مختلفة تماماً من الدالة (نفس الدرس الموثَّق
--  في printRelay.ts أعلى هذا الملف)، فالعدّاد لا يتراكم عبر النسخ ويسهل
--  تجاوز حد المحاولات (5) بمجرد أن تتوزّع الطلبات على نسخ مختلفة.
--
--  يحافظ هذا الجدول/الدالة على نفس منطق القفل المتصاعد الأصلي (5 محاولات
--  فاشلة تقفل لمدة تتضاعف: 1، 2, 4، 8، بحد أقصى 15 دقيقة، وتُصفَّر بالكامل
--  عند نجاح المطابقة) بدل مجرد نافذة عدّ ثابتة كـtracking_attempts.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pin_verify_attempts (
  attempt_key   text PRIMARY KEY,
  fail_count    integer NOT NULL DEFAULT 0,
  lock_until    timestamptz,
  lock_minutes  integer NOT NULL DEFAULT 1,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pin_verify_attempts ENABLE ROW LEVEL SECURITY;
-- عمداً بلا أي سياسة: الوصول حصراً عبر supabaseAdmin (service_role) من
-- السيرفر، الذي يتجاوز RLS أصلاً.

CREATE OR REPLACE FUNCTION public.record_pin_verify_failure(
  p_key text,
  p_max_attempts integer DEFAULT 5,
  p_max_lock_minutes integer DEFAULT 15
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fail_count   integer;
  v_lock_minutes integer;
  v_lock_until   timestamptz;
BEGIN
  INSERT INTO pin_verify_attempts (attempt_key, fail_count, lock_minutes, updated_at)
  VALUES (p_key, 1, 1, now())
  ON CONFLICT (attempt_key) DO UPDATE SET
    fail_count = pin_verify_attempts.fail_count + 1,
    updated_at = now()
  RETURNING fail_count, lock_minutes INTO v_fail_count, v_lock_minutes;

  IF v_fail_count >= p_max_attempts THEN
    v_lock_until := now() + (v_lock_minutes || ' minutes')::interval;
    UPDATE pin_verify_attempts
       SET lock_until = v_lock_until,
           lock_minutes = LEAST(v_lock_minutes * 2, p_max_lock_minutes),
           fail_count = 0
     WHERE attempt_key = p_key;
    RETURN v_lock_until;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_pin_verify_attempts(p_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM pin_verify_attempts WHERE attempt_key = p_key;
$function$;

REVOKE ALL ON FUNCTION public.record_pin_verify_failure(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_pin_verify_attempts(text) FROM PUBLIC;
