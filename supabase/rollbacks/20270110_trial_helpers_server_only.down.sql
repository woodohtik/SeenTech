-- Rollback of 20270110000000_trial_helpers_server_only.sql
GRANT EXECUTE ON FUNCTION public.has_used_trial(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_tenant_trial(uuid, integer) TO anon, authenticated;
