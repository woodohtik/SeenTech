-- seen-cto-sprint0-critical-fixes-task.md item 1 (SRV-01): per-caller rate
-- limit on /api/staff/create-account (5 attempts/minute), matching the same
-- Postgres-backed fixed-window pattern already used for print-pairing
-- (print_pair_attempts_global / increment_global_pair_attempt) and PIN
-- verification (pin_verify_attempts), keyed per caller uid instead of
-- globally or per-IP -- this endpoint already requires `authenticate`, so
-- every caller has a stable uid to key on.

CREATE TABLE IF NOT EXISTS public.staff_account_create_attempts (
  caller_uid TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  reset_at   TIMESTAMPTZ NOT NULL DEFAULT now() + interval '60 seconds'
);

ALTER TABLE public.staff_account_create_attempts ENABLE ROW LEVEL SECURITY;
-- No policy for 'authenticated'/'anon' -- touched only via the SECURITY
-- DEFINER RPC below, called from the server's service-role client.

CREATE OR REPLACE FUNCTION public.increment_staff_account_create_attempt(p_caller_uid TEXT)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO public.staff_account_create_attempts (caller_uid, count, reset_at)
  VALUES (p_caller_uid, 1, now() + interval '60 seconds')
  ON CONFLICT (caller_uid) DO UPDATE SET
    count = CASE WHEN staff_account_create_attempts.reset_at > now()
                 THEN staff_account_create_attempts.count + 1
                 ELSE 1 END,
    reset_at = CASE WHEN staff_account_create_attempts.reset_at > now()
                    THEN staff_account_create_attempts.reset_at
                    ELSE now() + interval '60 seconds' END
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_staff_account_create_attempt(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_staff_account_create_attempt(TEXT) TO authenticated;
