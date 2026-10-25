-- Security audit 2026-10-25, fingerprint
-- print-relay.pair.rate-limit-per-ip-distributed-bypass (medium):
-- increment_print_pair_attempt's counter was keyed purely by caller IP, so
-- an attacker distributing guesses across many source IPs faced no
-- aggregate limit at all, and the lookup itself matches pair_code across
-- every tenant's print_stations with no scoping -- any one tenant's valid
-- code counts as a win. /api/print/pair now also requires `authenticate`
-- (src/server/printRelay.ts), which excludes anonymous callers entirely;
-- this adds a single-row, IP-independent global counter as a second layer
-- against a distributed campaign mounted from several staff-held sessions.

CREATE TABLE IF NOT EXISTS public.print_pair_attempts_global (
  id       SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  count    INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '60 seconds'
);

INSERT INTO public.print_pair_attempts_global (id, count, reset_at)
VALUES (1, 0, now() + interval '60 seconds')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.print_pair_attempts_global ENABLE ROW LEVEL SECURITY;
-- No policy for 'authenticated'/'anon' -- this table is touched only via
-- the SECURITY DEFINER RPCs below, from the server's service-role client.

CREATE OR REPLACE FUNCTION public.increment_global_pair_attempt()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  UPDATE public.print_pair_attempts_global
  SET count = CASE WHEN reset_at > now() THEN count + 1 ELSE 1 END,
      reset_at = CASE WHEN reset_at > now() THEN reset_at ELSE now() + interval '60 seconds' END
  WHERE id = 1
  RETURNING count INTO new_count;

  RETURN new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_global_pair_attempt_count()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur_count integer;
  cur_reset timestamptz;
BEGIN
  SELECT count, reset_at INTO cur_count, cur_reset FROM public.print_pair_attempts_global WHERE id = 1;
  IF cur_reset IS NULL OR cur_reset <= now() THEN
    RETURN 0;
  END IF;
  RETURN COALESCE(cur_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.increment_global_pair_attempt() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_global_pair_attempt_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_global_pair_attempt() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_global_pair_attempt_count() TO authenticated;
