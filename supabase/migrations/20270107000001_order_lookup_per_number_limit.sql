-- seen-readiness-fixes-task.md P6 -- the public order lookup is limited per
-- order number as well as per IP.
--
-- increment_order_lookup_failure(order_number): one-hour window, kept in
-- tracking_attempts under the key 'order:<number>' (no clash with IPs).
-- The server refuses a number with 10 failures in the window. service_role
-- only.
-- Rollback: supabase/rollbacks/20270107_order_lookup_per_number_limit.down.sql

CREATE OR REPLACE FUNCTION public.increment_order_lookup_failure(p_order_number text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key   text := 'order:' || left(coalesce(p_order_number, ''), 20);
  v_count integer;
BEGIN
  INSERT INTO tracking_attempts (ip, count, reset_at)
  VALUES (v_key, 1, now() + interval '1 hour')
  ON CONFLICT (ip) DO UPDATE SET
    count = CASE WHEN tracking_attempts.reset_at > now() THEN tracking_attempts.count + 1 ELSE 1 END,
    reset_at = CASE WHEN tracking_attempts.reset_at > now() THEN tracking_attempts.reset_at ELSE now() + interval '1 hour' END
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.increment_order_lookup_failure(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_order_lookup_failure(text) TO service_role;
