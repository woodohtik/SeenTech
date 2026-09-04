-- =============================================================================
--  عدّاد ذرّي لمحاولات تتبّع الطلب الفاشلة (يصلح سباق موجود بالفعل في
--  checkTrackingRateLimit، server.ts)
--  ------------------------------------------------------------------------
--  التحديث السابق لـ tracking_attempts كان قراءة ثم كتابة (select ثم
--  upsert count+1) من كود Node -- طلبان متزامنان لنفس IP (الآن أكثر
--  احتمالاً بعد مشاركة نفس الجدول بين GET وPOST .../subscribe) يقرآن نفس
--  count القديم ويكتب كلاهما نفس count+1 بدل التراكم الصحيح، فيسمح بتجاوز
--  TRACKING_ATTEMPTS_PER_MINUTE فعلياً تحت التزامن. نفس نمط
--  increment_assistant_usage (20260826000000_assistant_settings.sql):
--  الزيادة والفحص داخل جملة SQL واحدة عبر ON CONFLICT DO UPDATE.
-- =============================================================================

CREATE OR REPLACE FUNCTION increment_tracking_attempt(p_ip text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO tracking_attempts (ip, count, reset_at)
  VALUES (p_ip, 1, now() + interval '60 seconds')
  ON CONFLICT (ip) DO UPDATE SET
    count = CASE WHEN tracking_attempts.reset_at > now() THEN tracking_attempts.count + 1 ELSE 1 END,
    reset_at = CASE WHEN tracking_attempts.reset_at > now() THEN tracking_attempts.reset_at ELSE now() + interval '60 seconds' END
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$function$;

-- خاص بالسيرفر (supabaseAdmin) فقط -- بلا هذا، منح Postgres الافتراضي
-- يترك الدالة قابلة للاستدعاء من أي دور authenticated مباشرة عبر
-- supabase.rpc()، مثل الفجوة الموثّقة في
-- 20260822090300_trial_lifecycle_functions_revoke_public.sql.
REVOKE ALL ON FUNCTION increment_tracking_attempt(text) FROM PUBLIC;
