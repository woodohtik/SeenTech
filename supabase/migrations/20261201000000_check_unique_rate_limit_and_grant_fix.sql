-- seen-status-fix-regressions-task.md item 8, bullets 1-2.
--
-- 1) server.ts's /api/staff/pin 'check-unique' mode returns at line
--    ~1162 BEFORE the failure-recording block (~1166-1185) -- that block
--    only ever runs for the normal verify-PIN path. The comment above it
--    claims "rate-limited under its own key", but no attempt is ever
--    actually recorded for check-unique, so pin_verify_attempts.lock_until
--    for that key never gets set and the check at the top of the handler
--    never trips: an owner/admin/manager (the only callers now, since
--    the same prior fix restricted this mode to them) can still probe
--    every possible PIN at an unthrottled rate while assigning someone's
--    PIN, same as before that fix -- just from a narrower set of callers.
--    Fixed on the server (same commit as this migration) to record EVERY
--    check-unique call into a dedicated 20/minute counter, independent of
--    the wrong-PIN lockout semantics pin_verify_attempts/
--    record_pin_verify_failure exist for -- this needs a flat per-caller
--    rate limit, not a "lock out after N wrong guesses" one.
--
-- 2) increment_staff_account_create_attempt (20261114000000) was granted
--    EXECUTE to `authenticated` even though it is only ever called from
--    server.ts with the service-role client, and takes p_caller_uid as a
--    plain parameter rather than deriving it from auth.uid() internally
--    -- so any authenticated staff member could call it directly with a
--    uid that isn't their own, pumping another user's counter past the
--    5/minute cap as a denial-of-service against that person's ability to
--    add staff. Revoked from authenticated/anon; granted to service_role
--    only (matches remap_user_uid's own grant, 20260815).
REVOKE ALL ON FUNCTION public.increment_staff_account_create_attempt(TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.increment_staff_account_create_attempt(TEXT) TO service_role;

CREATE TABLE IF NOT EXISTS public.check_unique_attempts (
  caller_uid TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  reset_at   TIMESTAMPTZ NOT NULL DEFAULT now() + interval '60 seconds'
);

ALTER TABLE public.check_unique_attempts ENABLE ROW LEVEL SECURITY;
-- No policy for 'authenticated'/'anon' -- touched only via the SECURITY
-- DEFINER RPC below, called from the server's service-role client, same
-- shape as staff_account_create_attempts.

CREATE OR REPLACE FUNCTION public.increment_check_unique_attempt(p_caller_uid TEXT)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO public.check_unique_attempts (caller_uid, count, reset_at)
  VALUES (p_caller_uid, 1, now() + interval '60 seconds')
  ON CONFLICT (caller_uid) DO UPDATE SET
    count = CASE WHEN check_unique_attempts.reset_at > now()
                 THEN check_unique_attempts.count + 1
                 ELSE 1 END,
    reset_at = CASE WHEN check_unique_attempts.reset_at > now()
                    THEN check_unique_attempts.reset_at
                    ELSE now() + interval '60 seconds' END
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_check_unique_attempt(TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.increment_check_unique_attempt(TEXT) TO service_role;
