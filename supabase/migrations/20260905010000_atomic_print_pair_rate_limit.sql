-- =============================================================================
--  عدّاد ذرّي لمحاولات اقتران الطباعة الفاشلة -- يُطبِّق نفس إصلاح
--  20260904010000_atomic_tracking_rate_limit.sql على /api/print/pair،
--  الذي كان يستخدم بالضبط نفس نمط قراءة-ثم-كتابة غير الذرّي (select count
--  ثم upsert count+1) الذي أُصلح هناك لكن لم يُنقَل هنا. طلبا اقتران
--  متزامنان من نفس IP يقرآن نفس count القديم ويكتب كلاهما نفس count+1 بدل
--  التراكم الصحيح، فيسمح بتجاوز pairAttemptsPerMinute (10/دقيقة) فعلياً
--  تحت التزامن.
-- =============================================================================

CREATE OR REPLACE FUNCTION increment_print_pair_attempt(p_ip text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO print_pair_attempts (ip, count, reset_at)
  VALUES (p_ip, 1, now() + interval '60 seconds')
  ON CONFLICT (ip) DO UPDATE SET
    count = CASE WHEN print_pair_attempts.reset_at > now() THEN print_pair_attempts.count + 1 ELSE 1 END,
    reset_at = CASE WHEN print_pair_attempts.reset_at > now() THEN print_pair_attempts.reset_at ELSE now() + interval '60 seconds' END
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$function$;

REVOKE ALL ON FUNCTION increment_print_pair_attempt(text) FROM PUBLIC;
