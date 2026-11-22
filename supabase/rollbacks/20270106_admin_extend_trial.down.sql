-- Rollback of 20270106000002_admin_extend_trial.sql
DROP TRIGGER IF EXISTS tenants_keep_created_at ON public.tenants;
DROP FUNCTION IF EXISTS public.tenants_keep_created_at();
DROP FUNCTION IF EXISTS public.admin_extend_trial(uuid, integer);
