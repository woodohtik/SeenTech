-- Rollback of 20270101000006_permissions_live.sql.
DROP TRIGGER IF EXISTS staff_deactivation_ends_sessions ON public.staff;
DROP FUNCTION IF EXISTS public.staff_deactivation_ends_sessions();
ALTER PUBLICATION supabase_realtime DROP TABLE public.user_permission_overrides;
ALTER PUBLICATION supabase_realtime DROP TABLE public.roles;
