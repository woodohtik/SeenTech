-- Rollback of 20261231000002_fix_non_mens_order_status.sql: the old statuses
-- back from the backup table (triggers off, as when they were changed).
SET session_replication_role = replica;
UPDATE public.orders o SET status = b.old_status
  FROM public._backup_20261231_order_status b
 WHERE b.kind = 'order' AND b.row_id = o.id;
UPDATE public.order_items i SET status = b.old_status
  FROM public._backup_20261231_order_status b
 WHERE b.kind = 'item' AND b.row_id = i.id;
SET session_replication_role = origin;
DROP TABLE IF EXISTS public._backup_20261231_order_status;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261231000002';
