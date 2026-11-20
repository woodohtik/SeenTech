-- Rollback for 20261229000000_get_dashboard_stats.sql
-- (seen-performance-first-open-login-task.md Phase 4.3). The dashboard falls
-- back to reading the rows itself when the function is missing, so this is
-- safe to run while the new client code is live.
DROP FUNCTION IF EXISTS public.get_dashboard_stats(uuid, uuid, jsonb, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.dashboard_order_rows(uuid, uuid);
DROP FUNCTION IF EXISTS public.dashboard_order_completed_at(text);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261229000000';

-- 20261229000001_get_low_stock_items.sql
DROP FUNCTION IF EXISTS public.get_low_stock_items(uuid, int);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261229000001';

-- 20261229000002_get_setup_progress.sql
DROP FUNCTION IF EXISTS public.get_setup_progress(uuid);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261229000002';
