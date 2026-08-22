-- B-4 (security-fix-tasklist.md): these functions had no REVOKE anywhere in
-- PLG_trial_lifecycle.sql, so Postgres's default grants left them callable
-- by any authenticated (and in the sweep functions' case, potentially any)
-- role directly via supabase.rpc(), independent of whatever UI does or
-- doesn't call them.
--
-- activate_tenant_subscription in particular is a plain (non-SECURITY
-- DEFINER) SQL function with zero authorization checks in its body -- it
-- just runs `UPDATE tenants SET is_trial=false, subscription_status='active'
-- ... WHERE id=p_tenant_id` for whatever tenant_id is passed in. Confirmed
-- via `grep -rn "activate_tenant_subscription" src/`: trialService.ts
-- exports activateSubscription() wrapping this RPC, but it has zero callers
-- anywhere in the app today -- so this was only "safe" by accident, because
-- the tenants_owner_update RLS policy was separately broken (see B-5) and
-- denied the UPDATE regardless of who called it. Fixing that policy in B-5
-- would have made this immediately exploitable -- free subscription
-- activation for your own tenant via a raw RPC call -- if this REVOKE
-- weren't applied first.
--
-- start_tenant_trial/trial_lock_sweep/trial_purge_sweep/slg_sweep are
-- meant to run as scheduled/service-role jobs, not be callable by tenant
-- users at all.

REVOKE ALL ON FUNCTION activate_tenant_subscription(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION start_tenant_trial(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION trial_lock_sweep() FROM PUBLIC;
REVOKE ALL ON FUNCTION trial_purge_sweep() FROM PUBLIC;
REVOKE ALL ON FUNCTION slg_sweep() FROM PUBLIC;

-- start_tenant_trial IS called from the client at signup (trialService.ts
-- startTrial()) to grant the initial 14-day trial -- keep that path working.
GRANT EXECUTE ON FUNCTION start_tenant_trial(uuid, int) TO authenticated;
