-- seen-cto-code-review-2026-11-13.md C4, سبرنت 1 البند 7.
--
-- Founder decisions (2026-11-15, via AskUserQuestion):
--   1. Pre-existing tenants with no trial_ends_at: backfill now
--      (created_at + 14 days), so the lock mechanism actually covers
--      them too, not just signups after 2026-11-14's billing-defaults fix.
--   2. Locked owner: stays able to log in to a renewal/billing view only.
--   3. Locked staff (non-owner): cut off entirely (read + write).
--   4. Expired PAID subscription (subscription_end_date passed): locks
--      immediately, same as trial -- no grace period.
--
-- Prior state (confirmed live, not assumed):
--   - tenants_force_safe_billing_defaults (2026-11-14) already stops a
--     tampered signup from claiming a paid/active subscription, and
--     already populates trial_started_at/trial_ends_at correctly for
--     every NEW signup -- confirmed by simulating a client-shaped INSERT
--     against the current trigger. The "trial_ends_at never populated"
--     problem only affects tenants created BEFORE that migration.
--   - app_current_tenant_id() already returns NULL for a manually
--     suspended tenant (status='inactive'), enforced at the RLS layer.
--   - trial_lock_sweep (pg_cron, every 15 min) already flips an expired
--     trial's subscription_status to 'locked' -- but NOTHING server-side
--     ever checked that value. A locked tenant's staff could keep using
--     every feature; only a client-side screen (bypassable via devtools,
--     per the review's own framing) showed a lock message. This is the
--     literal "القفل شكلي" (cosmetic lock) C4 names.
--   - Paid (non-trial) subscriptions had NO expiry sweep at all --
--     subscription_end_date passing left subscription_status='active'
--     forever.
--
-- Fix:
--   1. Backfill trial_started_at/trial_ends_at for pre-existing trial
--      tenants that predate the billing-defaults trigger.
--   2. trial_lock_sweep now also locks an 'active' (paid) tenant whose
--      subscription_end_date has passed, not just an expired trial.
--   3. trial_purge_sweep is explicitly restricted to is_trial=true --
--      the 30-day-then-hard-delete-everything policy was designed for
--      abandoned free trials; silently extending permanent data deletion
--      to a paying merchant over a missed renewal is a materially
--      different, higher-stakes decision the founder was not asked
--      about here, so it is deliberately NOT applied to paid tenants.
--   4. app_current_tenant_id() now ALSO returns NULL when the caller's
--      tenant is subscription_status IN ('locked','purge_pending'), or
--      when subscription_end_date has passed (a live check, closing the
--      window between expiry and the next 15-minute sweep run) --
--      cutting off every RLS-scoped table immediately, for owner and
--      staff alike (same mechanism the inactive-tenant fix already
--      uses).
--   5. The owner-only "still reachable while locked" carve-out needs NO
--      new policy: tenants_read/tenants_read_own already grants SELECT
--      via `owner_uid = app_current_uid()`, independent of
--      app_current_tenant_id() -- confirmed this is exactly, and only,
--      what the current lock screen (App.tsx's isSubscriptionExpired
--      branch) reads (tenant name, created_at) before showing its
--      "contact us to reactivate" message; it renders no other route and
--      calls no other table while locked, so no further carve-out
--      (e.g. subscription_requests) is needed to match today's actual
--      UI. Widening self-service renewal beyond that static screen is a
--      separate, larger product change, not done here.

-- (1) Backfill pre-existing trial tenants with no trial_ends_at.
UPDATE public.tenants
   SET trial_started_at = created_at,
       trial_ends_at = created_at + interval '14 days'
 WHERE subscription_status = 'trial' AND trial_ends_at IS NULL;

-- (2) Extend the existing sweep (same cron job, same name, same cadence --
-- no new pg_cron registration needed) to also lock an expired paid
-- subscription.
CREATE OR REPLACE FUNCTION public.trial_lock_sweep()
RETURNS void LANGUAGE sql AS $$
  UPDATE tenants SET subscription_status='locked', locked_at=now(), purge_at=now() + interval '30 days'
  WHERE (subscription_status = 'trial' AND trial_ends_at IS NOT NULL AND trial_ends_at < now())
     OR (subscription_status = 'active' AND subscription_end_date IS NOT NULL AND subscription_end_date < now());
$$;

-- (3) Restrict the destructive purge sweep to abandoned trials only.
CREATE OR REPLACE FUNCTION public.trial_purge_sweep()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM tenants
           WHERE subscription_status = 'locked' AND is_trial = true
             AND purge_at IS NOT NULL AND purge_at < now()
  LOOP
    DELETE FROM orders            WHERE tenant_id = r.id;
    DELETE FROM customers         WHERE tenant_id = r.id;
    DELETE FROM inventory_items   WHERE tenant_id = r.id;
    DELETE FROM staff             WHERE tenant_id = r.id;
    DELETE FROM branches          WHERE tenant_id = r.id;
    UPDATE tenants SET subscription_status='purge_pending', is_trial=false WHERE id = r.id;
    UPDATE leads SET status='lost' WHERE tenant_id = r.id AND status NOT IN ('paid');
  END LOOP;
END; $$;

-- (4) The real enforcement point: every RLS policy keyed on
-- app_current_tenant_id() now stops matching any row the instant a
-- tenant is locked/purging or its paid term has lapsed -- for owner and
-- staff alike (the tenants_read*/staff_read_own `owner_uid =
-- app_current_uid()` clauses are separate policies, untouched, and are
-- what keeps the lock screen itself working for the owner).
CREATE OR REPLACE FUNCTION public.app_current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    t_id UUID;
    cur_uid TEXT;
    t_status TEXT;
    t_sub_status TEXT;
    t_sub_end TIMESTAMPTZ;
BEGIN
    cur_uid := app_current_uid();
    IF cur_uid IS NULL THEN RETURN NULL; END IF;

    -- 1. Check if user is staff (Owner is often also staff)
    SELECT tenant_id INTO t_id FROM staff WHERE uid = cur_uid AND status = 'active' LIMIT 1;

    -- 2. Check if user is owner directly from tenants table
    IF t_id IS NULL THEN
        SELECT id INTO t_id FROM tenants WHERE owner_uid = cur_uid LIMIT 1;
    END IF;

    IF t_id IS NULL THEN RETURN NULL; END IF;

    -- 3. A suspended tenant has no active tenant scope at all -- every RLS
    -- policy keyed on this function stops matching any row for them.
    SELECT status, subscription_status, subscription_end_date
      INTO t_status, t_sub_status, t_sub_end
      FROM tenants WHERE id = t_id;

    IF t_status = 'inactive' THEN
        RETURN NULL;
    END IF;

    -- seen-cto-code-review-2026-11-13.md C4: subscription_status already
    -- gets set to 'locked'/'purge_pending' by the sweep above, but
    -- nothing used to check it here -- this was the whole "cosmetic
    -- lock" problem. The subscription_end_date check is a live
    -- top-up for the up-to-15-minute gap before the next sweep run.
    IF t_sub_status IN ('locked', 'purge_pending') THEN
        RETURN NULL;
    END IF;

    IF t_sub_end IS NOT NULL AND t_sub_end < now() THEN
        RETURN NULL;
    END IF;

    RETURN t_id;
END;
$$;
