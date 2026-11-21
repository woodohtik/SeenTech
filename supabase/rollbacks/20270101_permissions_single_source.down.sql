-- Rollback of 20270101000000_permissions_single_source.sql (staging/production).
-- Restores app_has_permission as it was (staff.role_id, then app_default_permission)
-- and removes what the migration added.
CREATE OR REPLACE FUNCTION public.app_has_permission(p_permission_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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

DROP FUNCTION IF EXISTS public.get_my_permissions();
DROP FUNCTION IF EXISTS public.app_effective_permissions(uuid);
DROP TABLE IF EXISTS public.role_default_permissions;
ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_base_role_check;
ALTER TABLE public.roles DROP COLUMN IF EXISTS base_role;
