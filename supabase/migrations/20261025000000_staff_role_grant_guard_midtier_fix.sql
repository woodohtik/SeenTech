-- Security audit 2026-10-25, fingerprint staff-role-grant-guard-midtier-bypass
-- (critical): staff_role_grant_guard() only ever guarded grants of the
-- platform roles ('super_admin','support_tech','billing_admin') and the two
-- top merchant roles ('owner','admin'). The remaining merchant roles in the
-- user_role enum -- 'manager','branch_manager','accountant','warehouse_manager'
-- -- were never checked in either the role::text branch or the role_id->
-- roles.role_key mirror branch, so any authenticated staff member (any role,
-- including cashier) could UPDATE a coworker's row -- or INSERT a brand-new
-- self-onboarding row for ANY tenant_id via the separate staff_onboarding_insert
-- policy below, which has no tenant_id predicate at all -- to grant themselves
-- 'manager' (near-full permissions per src/services/permissionService.ts) or
-- 'branch_manager' (staff.create/staff.edit + financial reports + inventory/
-- payment actions), with zero actor-privilege requirement. This is a full
-- cross-tenant privilege-escalation path via the self-onboarding INSERT.
--
-- Fix: extend the trigger's guarded-role check to every role above the plain
-- self-registering default (cashier/tailor), requiring the actor already be
-- owner/admin to grant it -- applied identically to the role_id->role_key
-- mirror branch. Separately, tighten staff_onboarding_insert to the one role
-- its only real caller (ForcePinSetup.tsx's post-bootstrap-RPC fallback)
-- actually uses: 'cashier'. This closes the role-escalation path at both the
-- trigger and the policy layer; it does not add a tenant_id check to
-- staff_onboarding_insert (that policy's unrestricted tenant_id is a lower-
-- severity, separate "self-join an uninvited tenant as cashier" gap, left
-- for a follow-up pass since the legitimate ForcePinSetup.tsx flow's actual
-- tenant_id provenance was not fully traced in this fix).

CREATE OR REPLACE FUNCTION public.staff_role_grant_guard() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role      text;
  new_role_id_key text;
BEGIN
  IF app_is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.role_id IS NOT DISTINCT FROM OLD.role_id
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.role::text IN ('super_admin', 'support_tech', 'billing_admin') THEN
    RAISE EXCEPTION 'لا يمكن منح دور منصّة (%) بدون صلاحية super_admin فعلية', NEW.role
      USING ERRCODE = '42501';
  END IF;

  -- Extended: every role above the plain self-registering default
  -- (owner/admin AND manager/branch_manager/accountant/warehouse_manager)
  -- now requires the actor to already be owner/admin before granting it.
  IF NEW.role::text IN ('owner', 'admin', 'manager', 'branch_manager', 'accountant', 'warehouse_manager') THEN
    actor_role := app_current_role();
    IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'لا يمكن منح دور % بدون أن يكون المستخدم الحالي owner أو admin بالفعل', NEW.role
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.role_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id) THEN
    SELECT role_key INTO new_role_id_key FROM public.roles WHERE id = NEW.role_id;

    IF new_role_id_key IN ('super_admin', 'support_tech', 'billing_admin') THEN
      RAISE EXCEPTION 'لا يمكن منح دور منصّة (%) عبر role_id بدون صلاحية super_admin فعلية', new_role_id_key
        USING ERRCODE = '42501';
    END IF;

    -- Same extension applied to the role_id path: covers system-seeded
    -- mid-tier roles and any custom role, since any role_id grant to
    -- another row now requires owner/admin regardless of its name.
    IF new_role_id_key IS DISTINCT FROM NULL AND new_role_id_key NOT IN ('cashier', 'tailor') THEN
      actor_role := COALESCE(actor_role, app_current_role());
      IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'لا يمكن منح دور % عبر role_id بدون أن يكون المستخدم الحالي owner أو admin بالفعل', new_role_id_key
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- تعطيل/تفعيل صف آخر غير صف الفاعل نفسه: يتطلب owner/admin. (صف الفاعل
  -- نفسه محمي أصلاً عبر staff_no_self_escalation_trigger لكل غير super_admin.)
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND OLD.uid IS DISTINCT FROM app_current_uid() THEN
    actor_role := COALESCE(actor_role, app_current_role());
    IF actor_role IS NULL OR actor_role NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'لا يمكن تعديل حالة موظف آخر بدون أن يكون المستخدم الحالي owner أو admin'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- staff_onboarding_insert previously excluded only 'owner'/'admin' from a
-- self-onboarding INSERT (uid = app_current_uid()), silently letting the
-- same INSERT set role to any mid-tier value instead. The trigger above now
-- independently blocks that for any non-owner/admin actor, but tighten the
-- policy itself too, to the one role its sole legitimate caller
-- (src/components/ForcePinSetup.tsx's post-bootstrap-RPC fallback) actually
-- uses, as defense in depth that does not depend on the trigger alone.
DROP POLICY IF EXISTS "staff_onboarding_insert" ON staff;
CREATE POLICY "staff_onboarding_insert" ON staff
    FOR INSERT WITH CHECK (
        app_is_super_admin()
        OR (uid = app_current_uid() AND role = 'cashier'::user_role)
    );
