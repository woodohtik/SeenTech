-- Rollback of 20261231000004_admin_change_tenant_vertical.sql.
-- (A shop's vertical changed through it stays as it is; the audit log keeps the record.)
DROP FUNCTION IF EXISTS public.admin_change_tenant_vertical(uuid, text);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261231000004';
