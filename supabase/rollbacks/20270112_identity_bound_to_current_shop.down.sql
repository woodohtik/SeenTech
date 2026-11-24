-- Rollback of 20270112000000_identity_bound_to_current_shop.sql: the definitions as they were before it.

CREATE OR REPLACE FUNCTION public.app_current_role()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cur_uid TEXT;
  r TEXT;
  v_acting uuid;
BEGIN
  v_acting := public.app_acting_staff_id();
  IF v_acting IS NOT NULL THEN
    SELECT role::text INTO r FROM staff WHERE id = v_acting;  -- NULL for an invalid session
    RETURN r;
  END IF;

  cur_uid := app_current_uid();
  IF cur_uid IS NULL THEN RETURN NULL; END IF;

  SELECT role::text INTO r FROM staff WHERE uid = cur_uid AND status = 'active' LIMIT 1;
  IF r IS NOT NULL THEN
    RETURN r;
  END IF;

  IF EXISTS (SELECT 1 FROM tenants WHERE owner_uid = cur_uid) THEN
    RETURN 'owner';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.app_current_staff_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s uuid; cur text;
BEGIN
  s := public.app_acting_staff_id();
  IF s = '00000000-0000-0000-0000-000000000000'::uuid THEN RETURN NULL; END IF;  -- invalid PIN session
  IF s IS NOT NULL THEN RETURN s; END IF;
  cur := public.app_current_uid();
  IF cur IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO s FROM public.staff
   WHERE uid = cur AND status = 'active'
   LIMIT 1;
  RETURN s;
END $function$;

CREATE OR REPLACE FUNCTION public.app_effective_permissions(p_staff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_staff     record;
  v_defaults  jsonb;
  v_role_perm jsonb;
  v_overrides jsonb;
BEGIN
  SELECT id, tenant_id, role::text AS role, role_id INTO v_staff FROM public.staff WHERE id = p_staff_id;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;

  IF v_staff.role = 'owner' THEN
    RETURN (SELECT coalesce(jsonb_object_agg(permission_key, true), '{}'::jsonb)
              FROM public.role_default_permissions WHERE role_key = 'owner');
  END IF;

  SELECT coalesce(jsonb_object_agg(permission_key, allowed), '{}'::jsonb) INTO v_defaults
    FROM public.role_default_permissions WHERE role_key = v_staff.role;

  IF v_staff.role_id IS NOT NULL THEN
    SELECT permissions INTO v_role_perm FROM public.roles WHERE id = v_staff.role_id;
  END IF;
  IF v_role_perm IS NULL THEN
    SELECT permissions INTO v_role_perm FROM public.roles
     WHERE tenant_id = v_staff.tenant_id AND role_key = v_staff.role;
  END IF;
  IF v_role_perm IS NULL THEN
    SELECT permissions INTO v_role_perm FROM public.roles
     WHERE tenant_id IS NULL AND role_key = v_staff.role;
  END IF;

  SELECT overrides INTO v_overrides FROM public.user_permission_overrides WHERE staff_id = v_staff.id;

  -- Later layers win key by key; non-boolean junk in a JSONB opinion reads as false.
  RETURN (
    SELECT coalesce(jsonb_object_agg(k, CASE WHEN jsonb_typeof(v) = 'boolean' THEN v ELSE 'false'::jsonb END), '{}'::jsonb)
      FROM jsonb_each(v_defaults || coalesce(v_role_perm, '{}'::jsonb) || coalesce(v_overrides, '{}'::jsonb)) AS e(k, v)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_ids_with_pin_set(p_tenant_id uuid)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (app_is_super_admin() OR p_tenant_id = app_current_tenant_id()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT id FROM public.staff WHERE tenant_id = p_tenant_id AND pin_hash IS NOT NULL;
END;
$function$;

DROP TRIGGER IF EXISTS staff_identity_guard_trigger ON public.staff;
DROP FUNCTION IF EXISTS public.staff_identity_guard();
DROP TRIGGER IF EXISTS users_self_write_guard_trigger ON public.users;
DROP FUNCTION IF EXISTS public.users_self_write_guard();
