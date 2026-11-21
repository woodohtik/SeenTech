-- Rollback of 20261231000003_dashboard_stats_by_phase.sql: re-apply the
-- dashboard functions of 20261229000000 (counting by stage key) and drop the
-- additions. Run from the repo root:
--   1. this file
--   2. npx supabase db query --linked --file supabase/migrations/20261229000000_get_dashboard_stats.sql
DROP FUNCTION IF EXISTS public.dashboard_order_rows(uuid, uuid);
DROP FUNCTION IF EXISTS public.dashboard_order_completed_at(text, text[]);
DROP FUNCTION IF EXISTS public.order_phase(text, text, text);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261231000003';
