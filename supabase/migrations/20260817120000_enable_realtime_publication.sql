-- Every useRealtimeSync() call in the app (inventory live sync, POS stock
-- updates, order tracking, and the new setup checklist bar) depends on
-- Supabase Realtime's postgres_changes feed - which requires the table to be
-- added to the `supabase_realtime` publication. Neither staging nor
-- production ever had ANY table in that publication (confirmed on both), so
-- every one of these "live sync" features has been silently doing nothing.
--
-- Guarded per-table (added 2026-09-28, after this file had already run on
-- staging): running the full backlog against production for the first time
-- ever found `tenants` already a member there -- someone/something added it
-- by hand after this comment's "confirmed on both" check, outside any
-- tracked migration (same schema-drift pattern as elsewhere in this repo).
-- The bare ALTER fails outright ("already member of publication") instead
-- of being a no-op, so each one now checks pg_publication_tables first.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants', 'inventory_items', 'branch_inventory', 'customers', 'orders', 'tax_invoices']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END $$;
