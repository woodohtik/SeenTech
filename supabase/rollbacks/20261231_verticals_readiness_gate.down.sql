-- Rollback of 20261231000000_verticals_readiness_gate.sql.
DROP TRIGGER IF EXISTS tenants_vertical_readiness_gate ON public.tenants;
DROP FUNCTION IF EXISTS public.tenants_vertical_readiness_gate();
ALTER TABLE public.verticals DROP CONSTRAINT IF EXISTS verticals_readiness_check;
ALTER TABLE public.verticals DROP COLUMN IF EXISTS readiness;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261231000000';
