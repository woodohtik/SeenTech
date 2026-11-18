-- seen-status-fix-regressions-task.md item 6 (🟠): staff_column_protection_guard
-- and staff_protect_owner_delete (20261114000001) only exempt
-- app_is_super_admin() -- a check keyed off auth.uid() from a real
-- authenticated session. Neither pg_cron (trial_purge_sweep, which runs
-- with no session at all) nor the server's own service-role client
-- (server.ts's supabaseAdmin -- used for cascading tenant deletion and
-- remap_user_uid) has an auth.uid() session, so app_is_super_admin()
-- returns false for them and these triggers block them exactly like an
-- ordinary unprivileged caller: trial_purge_sweep's `DELETE FROM staff
-- WHERE tenant_id = r.id` raises 'لا يمكن حذف صف المالك' and aborts the
-- whole sweep the moment it reaches a tenant's owner row; a super-admin
-- "delete this tenant entirely" cascade, and remap_user_uid, fail the
-- same way.
--
-- Fix: exempt `current_user IN ('postgres', 'service_role')` in addition
-- to app_is_super_admin() -- same pattern already used throughout this
-- codebase (tenants_owner_update_and_plan_guard, prevent_tax_invoice_tamper,
-- orders_protect_is_test, close_shift's own guard, ...), every one of
-- which learned the same lesson the hard way (20260920020000,
-- 20260920090000): current_user inside a SECURITY DEFINER function body
-- reflects the FUNCTION'S OWNER (typically `postgres`), not the actual
-- caller, which would make `current_user IN ('postgres','service_role')`
-- always true and silently disable the whole guard for every caller.
-- Both trigger functions are therefore made SECURITY INVOKER (dropped
-- entirely -- plain is the default) here, exactly like those precedents.
--
-- staff_column_protection_guard's one genuine need for elevated access
-- (reading auth.users, not grantable to `authenticated`) is split into a
-- separate, narrow SECURITY DEFINER helper that only answers "does this
-- uid/email pair match a real auth user" -- it makes no authorization
-- decision itself, so it carries none of the current_user risk above.

CREATE OR REPLACE FUNCTION public.staff_self_uid_link_is_valid(p_candidate_uid TEXT, p_old_email CITEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id::text = p_candidate_uid AND lower(u.email) = lower(p_old_email::text)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_self_uid_link_is_valid(TEXT, CITEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_self_uid_link_is_valid(TEXT, CITEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_column_protection_guard() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  actor_role TEXT;
  is_self BOOLEAN;
BEGIN
  IF app_is_super_admin() OR current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'لا يمكن تغيير المستأجر لصف موظف' USING ERRCODE = '42501';
  END IF;

  IF NEW.uid IS DISTINCT FROM OLD.uid THEN
    IF NOT (
      OLD.uid IS NULL
      AND NEW.uid = app_current_uid()
      AND public.staff_self_uid_link_is_valid(app_current_uid(), OLD.email)
    ) THEN
      RAISE EXCEPTION 'لا يمكن تغيير ربط المستخدم (uid) لهذا الموظف' USING ERRCODE = '42501';
    END IF;

    -- Legitimate first-login self-link (AuthContext.tsx:301 sends only
    -- `{ uid }`, nothing else): OLD.uid IS NULL here, so the is_self check
    -- below (which requires OLD.uid IS NOT NULL) would otherwise treat
    -- this as "editing someone else's row" and require the caller to
    -- already be owner/admin -- which an invited cashier linking their own
    -- row for the very first time is not. The check above already proved
    -- this is the caller's own account; accept it outright.
    RETURN NEW;
  END IF;

  actor_role := app_current_role();
  is_self := (OLD.uid IS NOT NULL AND OLD.uid = app_current_uid());

  IF NOT is_self THEN
    IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'لا يمكنك تعديل بيانات موظف آخر' USING ERRCODE = '42501';
    END IF;

    IF OLD.role = 'owner' AND actor_role <> 'owner' THEN
      RAISE EXCEPTION 'لا يمكن تعديل صف المالك إلا من المالك نفسه' USING ERRCODE = '42501';
    END IF;

    IF (NEW.commission_type IS DISTINCT FROM OLD.commission_type
        OR NEW.commission_value IS DISTINCT FROM OLD.commission_value
        OR NEW.commission_balance IS DISTINCT FROM OLD.commission_balance)
       AND actor_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'تعديل العمولة يتطلب owner أو admin' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  -- Self-edit: owner/admin get the same unrestricted access Onboarding.tsx
  -- already relies on (name/branch_id/must_change_pin on first login).
  IF actor_role IN ('owner', 'admin') THEN
    RETURN NEW;
  END IF;

  -- Self-edit by a non-owner/admin: only these operational columns.
  IF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.phone IS DISTINCT FROM OLD.phone
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.role_id IS DISTINCT FROM OLD.role_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.is_test IS DISTINCT FROM OLD.is_test
     OR NEW.commission_type IS DISTINCT FROM OLD.commission_type
     OR NEW.commission_value IS DISTINCT FROM OLD.commission_value
     OR NEW.commission_balance IS DISTINCT FROM OLD.commission_balance
  THEN
    RAISE EXCEPTION 'يمكنك فقط تعديل رمز الدخول الخاص بك أو حالة التعريف التمهيدي' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_protect_owner_delete() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF app_is_super_admin() OR current_user IN ('postgres', 'service_role') THEN
    RETURN OLD;
  END IF;

  IF OLD.role = 'owner' THEN
    RAISE EXCEPTION 'لا يمكن حذف صف المالك' USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;
