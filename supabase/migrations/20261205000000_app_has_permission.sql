-- seen-cto-sprint4-permissions-task.md item 3 / docs/superpowers/plans/
-- 2026-11-18-permissions-server-enforcement.md (Task 1) / docs/superpowers/
-- specs/2026-11-18-permissions-server-enforcement-design.md section 2.
--
-- Today, roles.permissions (tenant-custom role JSONB) and
-- user_permission_overrides (per-staff JSONB) are resolved client-side only
-- (getEffectivePermissions() in permissionService.ts). No RPC or RLS policy
-- checks either table -- disabling a permission in the "Role Permissions"
-- screen only hides UI, it never blocks the underlying action on the
-- server. This migration adds the server-side resolver that later tasks in
-- the same plan wire into the 11 financially/security-critical RPCs and RLS
-- policies named in the plan's Global Constraints section.
--
-- app_default_permission: the fixed fallback table used when a staff row
-- has no role_id (legacy rows) or its roles.permissions JSONB doesn't
-- mention the key being checked. Matches the plan's Global Constraints
-- matrix verbatim (itself transcribed from the current client-side
-- DEFAULT_ROLES in src/services/permissionService.ts for exactly these 11
-- keys). Any (role, key) pair not in the matrix -- including roles never
-- passed in here, such as 'owner', which app_has_permission short-circuits
-- before reaching this function -- returns false (fail-closed). STABLE, no
-- SECURITY DEFINER needed (reads nothing), but kept SECURITY DEFINER for
-- consistency with app_current_role()'s house style and so its EXECUTE
-- revocation below is meaningful regardless of caller.
CREATE OR REPLACE FUNCTION public.app_default_permission(p_role TEXT, p_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN CASE p_role
    WHEN 'admin' THEN
      CASE p_permission_key
        WHEN 'payments.collect' THEN true
        WHEN 'action.refund' THEN true
        WHEN 'action.discount' THEN true
        WHEN 'orders.delete' THEN true
        WHEN 'customers.delete' THEN true
        WHEN 'inventory.delete' THEN true
        WHEN 'staff.permissions' THEN true
        WHEN 'settings.billing' THEN false
        WHEN 'suppliers.manage' THEN true
        WHEN 'inventory.reconcile' THEN true
        WHEN 'shifts.manage' THEN true
        ELSE false
      END
    WHEN 'manager' THEN
      CASE p_permission_key
        WHEN 'payments.collect' THEN true
        WHEN 'action.refund' THEN true
        WHEN 'action.discount' THEN true
        WHEN 'orders.delete' THEN true
        WHEN 'customers.delete' THEN true
        WHEN 'inventory.delete' THEN true
        WHEN 'staff.permissions' THEN false
        WHEN 'settings.billing' THEN false
        WHEN 'suppliers.manage' THEN true
        WHEN 'inventory.reconcile' THEN true
        WHEN 'shifts.manage' THEN true
        ELSE false
      END
    WHEN 'branch_manager' THEN
      CASE p_permission_key
        WHEN 'payments.collect' THEN true
        WHEN 'action.refund' THEN true
        WHEN 'action.discount' THEN true
        WHEN 'orders.delete' THEN false
        WHEN 'customers.delete' THEN false
        WHEN 'inventory.delete' THEN false
        WHEN 'staff.permissions' THEN false
        WHEN 'settings.billing' THEN false
        WHEN 'suppliers.manage' THEN true
        WHEN 'inventory.reconcile' THEN true
        WHEN 'shifts.manage' THEN true
        ELSE false
      END
    WHEN 'accountant' THEN
      CASE p_permission_key
        WHEN 'payments.collect' THEN false
        WHEN 'action.refund' THEN true
        WHEN 'action.discount' THEN false
        WHEN 'orders.delete' THEN false
        WHEN 'customers.delete' THEN false
        WHEN 'inventory.delete' THEN false
        WHEN 'staff.permissions' THEN false
        WHEN 'settings.billing' THEN false
        WHEN 'suppliers.manage' THEN true
        WHEN 'inventory.reconcile' THEN false
        WHEN 'shifts.manage' THEN false
        ELSE false
      END
    WHEN 'warehouse_manager' THEN
      CASE p_permission_key
        WHEN 'payments.collect' THEN false
        WHEN 'action.refund' THEN false
        WHEN 'action.discount' THEN false
        WHEN 'orders.delete' THEN false
        WHEN 'customers.delete' THEN false
        WHEN 'inventory.delete' THEN true
        WHEN 'staff.permissions' THEN false
        WHEN 'settings.billing' THEN false
        WHEN 'suppliers.manage' THEN true
        WHEN 'inventory.reconcile' THEN true
        WHEN 'shifts.manage' THEN false
        ELSE false
      END
    WHEN 'cashier' THEN
      CASE p_permission_key
        WHEN 'payments.collect' THEN true
        WHEN 'action.refund' THEN false
        WHEN 'action.discount' THEN true
        WHEN 'orders.delete' THEN false
        WHEN 'customers.delete' THEN false
        WHEN 'inventory.delete' THEN false
        WHEN 'staff.permissions' THEN false
        WHEN 'settings.billing' THEN false
        WHEN 'suppliers.manage' THEN false
        WHEN 'inventory.reconcile' THEN false
        WHEN 'shifts.manage' THEN true
        ELSE false
      END
    WHEN 'tailor' THEN false
    ELSE false
  END;
END;
$function$;

-- Not exposed to authenticated -- app_has_permission (SECURITY DEFINER,
-- below) calls it internally while running as this function's owner, which
-- bypasses the EXECUTE ACL regardless of this revocation. No other task in
-- the plan calls app_default_permission directly.
REVOKE EXECUTE ON FUNCTION public.app_default_permission(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- app_has_permission: the 3-layer resolution pseudocoded in the design spec
-- section 2 -- super_admin/owner short-circuit, then the caller's own
-- role_id's roles.permissions JSONB (falling through to
-- app_default_permission when role_id is unset or the JSONB doesn't mention
-- the key -- the `?` "key exists" operator, not a truthiness check, per
-- Review Focus item 1 of the plan), then user_permission_overrides applied
-- the same way over whichever value the previous layer produced (override
-- wins only when the overrides JSONB actually mentions this key).
CREATE OR REPLACE FUNCTION public.app_has_permission(p_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_staff_id    uuid;
  v_role        text;
  v_role_id     uuid;
  v_permissions jsonb;
  v_overrides   jsonb;
  v_default     boolean;
BEGIN
  IF app_is_super_admin() THEN RETURN true; END IF;

  v_role := app_current_role();
  IF v_role = 'owner' THEN RETURN true; END IF;
  IF v_role IS NULL THEN RETURN false; END IF;

  v_staff_id := app_current_staff_id();
  SELECT role_id INTO v_role_id FROM public.staff WHERE id = v_staff_id;

  -- Layer 1 (role default) / Layer 2 (tenant custom role): a linked role_id
  -- with its own JSONB opinion on this key wins; otherwise fall through to
  -- the fixed default table for the caller's staff.role enum.
  IF v_role_id IS NOT NULL THEN
    SELECT permissions INTO v_permissions FROM public.roles WHERE id = v_role_id;
  END IF;

  IF v_permissions IS NOT NULL AND v_permissions ? p_permission_key THEN
    v_default := COALESCE((v_permissions ->> p_permission_key)::boolean, false);
  ELSE
    v_default := app_default_permission(v_role, p_permission_key);
  END IF;

  -- Layer 3 (per-user override): wins over the above only if the staff's
  -- overrides row exists AND actually mentions this key.
  SELECT overrides INTO v_overrides FROM public.user_permission_overrides WHERE staff_id = v_staff_id;

  IF v_overrides IS NOT NULL AND v_overrides ? p_permission_key THEN
    RETURN COALESCE((v_overrides ->> p_permission_key)::boolean, false);
  END IF;

  RETURN v_default;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.app_has_permission(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_has_permission(TEXT) TO authenticated;
