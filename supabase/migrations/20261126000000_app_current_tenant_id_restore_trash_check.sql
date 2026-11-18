-- seen-status-fix-regressions-task.md item 2 (🔴): 20261115070000 redefined
-- app_current_tenant_id() to add the subscription lock/expiry checks, but
-- it started from the PRE-trash-bin version of the function (the one
-- before 20261028000000_tenant_trash_bin.sql added `trashed_at IS NOT
-- NULL` to the same check) and never re-added that condition. Net effect:
-- since 20261115070000 shipped, a tenant moved to the trash bin (a
-- super-admin "soft delete", meant to cut off all access before the real,
-- irreversible DELETE) keeps full data access through every RLS policy --
-- the exact bug trash_tenant() existed to prevent.
--
-- Fix: one function definition with every condition together (inactive,
-- trashed, locked/purge_pending, expired paid term), STABLE (this
-- function runs once per row via RLS -- without STABLE, Postgres cannot
-- cache the result across rows in the same statement and re-executes the
-- whole staff/tenants lookup every time), and a deterministic ORDER BY on
-- the staff lookup (a user can hold more than one active staff row across
-- tenants; an unordered LIMIT 1 could return a different tenant_id on
-- different calls within the same request).

CREATE OR REPLACE FUNCTION public.app_current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    t_id UUID;
    cur_uid TEXT;
    t_status TEXT;
    t_trashed_at TIMESTAMPTZ;
    t_sub_status TEXT;
    t_sub_end TIMESTAMPTZ;
BEGIN
    cur_uid := app_current_uid();
    IF cur_uid IS NULL THEN RETURN NULL; END IF;

    -- 1. Check if user is staff (Owner is often also staff). Deterministic
    -- order: a user can hold more than one active staff row (across
    -- tenants); always resolve to the earliest one.
    SELECT tenant_id INTO t_id FROM staff
     WHERE uid = cur_uid AND status = 'active'
     ORDER BY created_at ASC
     LIMIT 1;

    -- 2. Check if user is owner directly from tenants table
    IF t_id IS NULL THEN
        SELECT id INTO t_id FROM tenants
         WHERE owner_uid = cur_uid
         ORDER BY created_at ASC
         LIMIT 1;
    END IF;

    IF t_id IS NULL THEN RETURN NULL; END IF;

    -- 3. Inactive, trashed, locked/purge_pending, or an expired paid term:
    -- every RLS policy keyed on this function stops matching any row for
    -- them, owner and staff alike.
    SELECT status, trashed_at, subscription_status, subscription_end_date
      INTO t_status, t_trashed_at, t_sub_status, t_sub_end
      FROM tenants WHERE id = t_id;

    IF t_status = 'inactive' THEN
        RETURN NULL;
    END IF;

    IF t_trashed_at IS NOT NULL THEN
        RETURN NULL;
    END IF;

    IF t_sub_status IN ('locked', 'purge_pending') THEN
        RETURN NULL;
    END IF;

    IF t_sub_end IS NOT NULL AND t_sub_end < now() THEN
        RETURN NULL;
    END IF;

    RETURN t_id;
END;
$$;
