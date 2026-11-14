-- seen-cto-sprint0-critical-fixes-task.md item 2 (STF-02, DB1-03).
--
-- Live RLS check on `staff` confirmed the real gap: staff_tenant_update
-- (the generic tenant_tables-loop policy) only checks tenant_id match --
-- ANY authenticated staff member (even a cashier) can currently UPDATE
-- ANY OTHER staff row in the same tenant. Two existing triggers narrow
-- this only partially:
--   - staff_no_self_escalation_trigger (20260822090100): blocks a caller
--     from changing role/role_id/status/tenant_id on THEIR OWN row.
--   - staff_role_grant_guard_update (20260908030000): blocks granting a
--     role beyond the actor's own privilege level, on ANY row.
-- Neither blocks a non-owner/admin from editing a COLLEAGUE's row at all
-- (name, email, phone, branch_id, pin_hash -- hijacking someone else's
-- PIN -- commission_*), nor protects `uid` (currently settable to
-- anything, including a value that collides with another row and breaks
-- authMiddleware.ts's .maybeSingle() lookup for that other account), nor
-- stops anyone but the owner from editing the owner's own row.
--
-- This migration does NOT touch the existing UPDATE/INSERT RLS policies
-- (StaffPinSetup.tsx / ForcePinSetup.tsx / PinLogin.tsx / OnboardingTour.tsx
-- / Onboarding.tsx / Staff.tsx / AuthContext.tsx:301 all still rely on
-- them) -- it adds a THIRD BEFORE UPDATE trigger layered on top of the
-- two above, plus BEFORE DELETE protection for `staff` and a tightened
-- DELETE policy on the financial tables.
--
-- Legitimate staff.update() column sets verified by reading every call
-- site in src/ (not just the 4 files named in the task):
--   - Self, non-owner/admin: pin_hash + must_change_pin (StaffPinSetup.tsx,
--     ForcePinSetup.tsx, PinLogin.tsx) or has_seen_onboarding
--     (OnboardingTour.tsx) or updated_at alongside those.
--   - Self, owner/admin: full row (Onboarding.tsx's first-login "Update
--     Owner Staff record": name/branch_id/must_change_pin).
--   - uid specifically: AuthContext.tsx:301, only when OLD.uid IS NULL,
--     NEW.uid = app_current_uid(), and the row's own email matches that
--     auth user's real email (not blindly trusted).
--   - Someone else's row: Staff.tsx (owner/admin managing employees) --
--     full column access except the owner's own row and commission_*,
--     per the task's explicit carve-outs.

CREATE OR REPLACE FUNCTION public.staff_column_protection_guard() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role TEXT;
  is_self BOOLEAN;
BEGIN
  IF app_is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'لا يمكن تغيير المستأجر لصف موظف' USING ERRCODE = '42501';
  END IF;

  IF NEW.uid IS DISTINCT FROM OLD.uid THEN
    IF NOT (
      OLD.uid IS NULL
      AND NEW.uid = app_current_uid()
      AND EXISTS (
        SELECT 1 FROM auth.users u
        WHERE u.id::text = app_current_uid() AND lower(u.email) = lower(OLD.email::text)
      )
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

DROP TRIGGER IF EXISTS staff_column_protection_guard_trigger ON public.staff;
CREATE TRIGGER staff_column_protection_guard_trigger
BEFORE UPDATE ON public.staff
FOR EACH ROW EXECUTE FUNCTION public.staff_column_protection_guard();

-- BEFORE DELETE: never delete an owner's row via this path (covers both
-- "can't delete the owner" and "can't delete the last remaining owner" --
-- blocking all owner-role deletions makes both impossible at once).
-- Ownership transfer/removal is a separate, deliberate flow, not a side
-- effect of the generic staff-management screen.
CREATE OR REPLACE FUNCTION public.staff_protect_owner_delete() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF app_is_super_admin() THEN
    RETURN OLD;
  END IF;

  IF OLD.role = 'owner' THEN
    RAISE EXCEPTION 'لا يمكن حذف صف المالك' USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS staff_protect_owner_delete_trigger ON public.staff;
CREATE TRIGGER staff_protect_owner_delete_trigger
BEFORE DELETE ON public.staff
FOR EACH ROW EXECUTE FUNCTION public.staff_protect_owner_delete();

-- Staff deletion itself: owner/admin only (was tenant-match only, same gap
-- as every other tenant_tables_loop DELETE policy). Orders.tsx:1434 and
-- the staff-management screen (Staff.tsx:701-711) are both owner/admin-
-- gated in the UI already; this is the first time it's enforced in the DB.
DROP POLICY IF EXISTS staff_tenant_delete ON public.staff;
CREATE POLICY staff_tenant_delete ON public.staff
  FOR DELETE USING (
    app_is_super_admin()
    OR (tenant_id = app_current_tenant_id() AND app_current_role() IN ('owner', 'admin'))
  );

-- Financial tables: replace the generic tenant-match-only DELETE policy
-- with owner/admin/manager, same role set Orders.tsx:1434 and
-- trialService.ts already assume for their own delete paths.
DO $$
DECLARE
  t TEXT;
  financial_tables TEXT[] := ARRAY['orders', 'order_items', 'payments', 'shifts', 'shift_entries', 'sales_returns'];
BEGIN
  FOREACH t IN ARRAY financial_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_delete ON %I;', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_tenant_delete ON %I
        FOR DELETE USING (
          app_is_super_admin()
          OR (tenant_id = app_current_tenant_id() AND app_current_role() IN ('owner', 'admin', 'manager'))
        );
    $p$, t, t);
  END LOOP;
END$$;
