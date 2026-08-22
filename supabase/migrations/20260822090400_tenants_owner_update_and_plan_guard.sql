-- B-5 (security-fix-tasklist.md): two separate problems found on live
-- inspection of the "tenants" table's RLS policies and columns.
--
-- (1) tenants_owner_update was still written against the pre-Supabase-Auth
-- current_setting('app.current_uid') session variable, which nothing in
-- this architecture ever sets anymore (confirmed live: every other
-- owner-facing policy on this table, e.g. tenants_read_own, already uses
-- app_current_uid()). That means the policy's condition
-- `owner_uid = current_setting('app.current_uid', true)` was always
-- `owner_uid = NULL`, i.e. always false -- tenant owners could not update
-- their own tenants row via a direct client call at all. Fixed to use
-- app_current_uid(), matching every other current policy.
--
-- (2) The schema has no subscription_end_date column (the tasklist that
-- prompted this migration assumed one) -- the real subscription-lifecycle
-- columns are plan_id, status (tenant_status: active/inactive/pending),
-- subscription_status (trial/active/locked/purge_pending), is_trial,
-- trial_started_at/trial_ends_at, locked_at, purge_at. None of them were
-- protected from a direct client UPDATE beyond the tenant-ownership check
-- above, meaning fixing (1) above would otherwise have reopened exactly
-- the "free plan upgrade via direct update" hole B-4 closed for the RPC
-- path.
--
-- The trigger below has to reconcile with two things already confirmed to
-- exist: (a) approveSubscriptionRequest() in subscriptionRequestService.ts
-- runs as a super_admin session and legitimately sets plan_id/status --
-- allowed via the app_is_super_admin() escape. (b) start_tenant_trial()
-- legitimately lets a brand-new tenant self-start its one free trial at
-- signup (trialService.ts) with no super_admin context at all -- allowed
-- via the "first trial only" escape (trial_started_at IS NULL). Once a
-- trial has been started once, further changes to plan/subscription
-- columns require super_admin, closing the "keep resetting my own trial
-- forever" route. current_user IN ('postgres','service_role') additionally
-- covers scheduled/service-role jobs (e.g. the trial_lock_sweep /
-- trial_purge_sweep / slg_sweep functions in PLG_trial_lifecycle.sql,
-- which have no code caller in this repo today and are presumably meant
-- to run via pg_cron or a service-role cron job outside the client).

DROP POLICY IF EXISTS tenants_owner_update ON tenants;
CREATE POLICY tenants_owner_update ON tenants
    FOR UPDATE USING (owner_uid = app_current_uid())
    WITH CHECK (owner_uid = app_current_uid());

CREATE OR REPLACE FUNCTION tenants_block_client_plan_edit() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF app_is_super_admin() OR current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    RAISE EXCEPTION 'تغيير الباقة يتطلب مساراً إدارياً، لا تحديثاً مباشراً';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'تغيير حالة الحساب يتطلب مساراً إدارياً، لا تحديثاً مباشراً';
  END IF;

  -- Allow the one-time self-service trial start (OLD.trial_started_at IS
  -- NULL); once a trial has ever been started, these columns can only
  -- change through an admin/service-role path.
  IF OLD.trial_started_at IS NOT NULL THEN
    IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
       OR NEW.is_trial IS DISTINCT FROM OLD.is_trial
       OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
       OR NEW.trial_started_at IS DISTINCT FROM OLD.trial_started_at
       OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
       OR NEW.purge_at IS DISTINCT FROM OLD.purge_at THEN
      RAISE EXCEPTION 'تعديل حالة الاشتراك/التجربة يتطلب مساراً إدارياً، لا تحديثاً مباشراً';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_block_client_plan_edit_trigger ON tenants;
CREATE TRIGGER tenants_block_client_plan_edit_trigger
BEFORE UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION tenants_block_client_plan_edit();
