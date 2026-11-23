-- seen-readiness-fixes-task.md P6 (PLATFORM-19) -- the trial helper functions
-- are for the server.
--
-- No client code calls has_used_trial or start_tenant_trial (the sign-up
-- flow never wired them in). They are kept for a server-side sign-up check
-- later, and executable by service_role only.
-- Rollback: supabase/rollbacks/20270110_trial_helpers_server_only.down.sql

REVOKE ALL ON FUNCTION public.has_used_trial(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_used_trial(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.start_tenant_trial(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_tenant_trial(uuid, integer) TO service_role;
