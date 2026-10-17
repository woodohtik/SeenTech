-- seen-deep-technical-audit.md Medium tier: stock_operations (the
-- idempotency-key table behind apply_stock_movement/create_pos_sale/
-- create_purchase_order's replay-safety) has no cleanup policy and grows
-- forever, even though a replayed request only needs to find its own prior
-- result within the retry window of a single HTTP request (seconds, not
-- days) -- 24-48h of retention is already generous.
--
-- Same guarded pg_cron pattern already used by
-- 20260910040000_backfill_plg_trial_lifecycle.sql: a no-op if the pg_cron
-- extension isn't enabled on a given environment, rather than failing the
-- migration.
CREATE OR REPLACE FUNCTION public.cleanup_stock_operations() RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.stock_operations WHERE created_at < now() - interval '48 hours';
$$;

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('seen_stock_operations_cleanup', '0 * * * *', $cron$SELECT public.cleanup_stock_operations();$cron$);
  END IF;
END $outer$;
