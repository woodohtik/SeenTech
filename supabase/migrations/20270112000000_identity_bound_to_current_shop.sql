-- Security audit of 22 Nov 2026 (docs/security/audit-2026-11-22), batch 1:
-- who you are, in which shop, with which role.
--
-- S-03  app_current_role() and app_current_staff_id() read any active staff
--       row of the caller, in no fixed order -- not necessarily the row of the
--       shop app_current_tenant_id() chose. Someone who is a cashier in shop A
--       and owns shop B could be treated as owner in A. Both now read the row
--       of the current shop, oldest first, as app_current_tenant_id() does.
-- S-39  The owner of a trashed, inactive or locked shop could still edit it:
--       app_current_role() answered 'owner' without looking at the shop's
--       state. With no current shop there is now no role.
-- S-13  staff.role_id could point at a custom role of another shop, and
--       app_effective_permissions() used it. A role now counts only when it
--       belongs to the staff row's own shop (or is global), and a staff row
--       cannot be given another shop's role.
-- S-15  An admin could promote a staff row to owner, and that row could then
--       demote the real owner. Only an owner makes, unmakes or changes an
--       owner row.
-- S-18  Anyone allowed to add staff could add a row carrying another
--       person's uid with an old created_at, and pull that person into their
--       shop (the oldest active row wins). A new row's created_at is now, and
--       it cannot carry the uid of someone who already owns or works in
--       another shop.
-- S-37  staff_ids_with_pin_set() let a caller with no shop at all read
--       another shop's staff ids (NULL slipped through the check).
-- S-38  A signed-in account could write any email into its own users row
--       (reserving someone else's) and set server-only fields.

-- S-03 / S-39 -------------------------------------------------------------
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
  v_tenant uuid;
BEGIN
  v_acting := public.app_acting_staff_id();
  IF v_acting IS NOT NULL THEN
    SELECT role::text INTO r FROM staff WHERE id = v_acting;  -- NULL for an invalid session
    RETURN r;
  END IF;

  cur_uid := app_current_uid();
  IF cur_uid IS NULL THEN RETURN NULL; END IF;

  -- The role in the shop the caller is in now (NULL when that shop is
  -- trashed, inactive or locked), never a row of another shop.
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN RETURN NULL; END IF;

  SELECT role::text INTO r FROM staff
   WHERE uid = cur_uid AND status = 'active' AND tenant_id = v_tenant
   ORDER BY created_at ASC
   LIMIT 1;
  IF r IS NOT NULL THEN
    RETURN r;
  END IF;

  IF EXISTS (SELECT 1 FROM tenants WHERE id = v_tenant AND owner_uid = cur_uid) THEN
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
DECLARE s uuid; cur text; v_tenant uuid;
BEGIN
  s := public.app_acting_staff_id();
  IF s = '00000000-0000-0000-0000-000000000000'::uuid THEN RETURN NULL; END IF;  -- invalid PIN session
  IF s IS NOT NULL THEN RETURN s; END IF;
  cur := public.app_current_uid();
  IF cur IS NULL THEN RETURN NULL; END IF;
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO s FROM public.staff
   WHERE uid = cur AND status = 'active' AND tenant_id = v_tenant
   ORDER BY created_at ASC
   LIMIT 1;
  RETURN s;
END $function$;

-- S-13 --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_effective_permissions(p_staff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_staff record;
  v_defaults jsonb;
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
    -- Only a role of the staff row's own shop, or a global one.
    SELECT permissions INTO v_role_perm FROM public.roles
     WHERE id = v_staff.role_id AND (tenant_id = v_staff.tenant_id OR tenant_id IS NULL);
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
  RETURN (
    SELECT coalesce(jsonb_object_agg(k, CASE WHEN jsonb_typeof(v) = 'boolean' THEN v ELSE 'false'::jsonb END), '{}'::jsonb)
      FROM jsonb_each(v_defaults || coalesce(v_role_perm, '{}'::jsonb) || coalesce(v_overrides, '{}'::jsonb)) AS e(k, v)
  );
END;
$function$;

-- S-13 / S-15 / S-18: one guard on staff rows, after the existing ones.
CREATE OR REPLACE FUNCTION public.staff_identity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role_tenant uuid;
  v_role_exists boolean;
  v_claims_role text := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
BEGIN
  -- Not limited here: the server (service role), the database itself (no
  -- request at all: migrations, admin scripts) and the platform's admins.
  -- (current_user would not tell: inside this definer function it is always the owner.)
  IF v_claims_role IN ('service_role', '') OR public.app_is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- S-13: a role of this shop, or a global one.
  IF NEW.role_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id) THEN
    SELECT true, tenant_id INTO v_role_exists, v_role_tenant FROM public.roles WHERE id = NEW.role_id;
    IF v_role_exists AND v_role_tenant IS NOT NULL AND v_role_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'role belongs to another shop' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- S-15: only an owner makes, unmakes or changes an owner row.
  IF (NEW.role::text = 'owner' AND (TG_OP = 'INSERT' OR OLD.role::text IS DISTINCT FROM 'owner'))
     OR (TG_OP = 'UPDATE' AND OLD.role::text = 'owner'
         AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status
              OR NEW.uid IS DISTINCT FROM OLD.uid OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id)) THEN
    IF public.app_current_role() IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'only the owner can change an owner' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- S-18: a new row is new.
    NEW.created_at := now();
    -- ...and cannot pull in someone who already owns or works in another
    -- shop (their own sign-up row, uid = caller, is the onboarding policy's).
    IF NEW.uid IS NOT NULL AND NEW.uid IS DISTINCT FROM public.app_current_uid() AND (
         EXISTS (SELECT 1 FROM public.tenants t WHERE t.owner_uid = NEW.uid AND t.id <> NEW.tenant_id)
      OR EXISTS (SELECT 1 FROM public.staff s WHERE s.uid = NEW.uid AND s.tenant_id <> NEW.tenant_id AND s.status = 'active')
    ) THEN
      RAISE EXCEPTION 'this account already belongs to another shop' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.uid IS DISTINCT FROM OLD.uid AND NEW.uid IS NOT NULL AND (
         EXISTS (SELECT 1 FROM public.tenants t WHERE t.owner_uid = NEW.uid AND t.id <> NEW.tenant_id)
      OR EXISTS (SELECT 1 FROM public.staff s WHERE s.uid = NEW.uid AND s.tenant_id <> NEW.tenant_id AND s.status = 'active')
  ) THEN
    RAISE EXCEPTION 'this account already belongs to another shop' USING ERRCODE = '42501';
  ELSIF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    NEW.created_at := OLD.created_at;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_identity_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS staff_identity_guard_trigger ON public.staff;
CREATE TRIGGER staff_identity_guard_trigger
  BEFORE INSERT OR UPDATE ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.staff_identity_guard();

-- S-37 --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_ids_with_pin_set(p_tenant_id uuid)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- coalesce: with no current shop the comparison is NULL, which used to pass.
  IF NOT coalesce(app_is_super_admin() OR p_tenant_id = app_current_tenant_id(), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT id FROM public.staff WHERE tenant_id = p_tenant_id AND pin_hash IS NOT NULL;
END;
$function$;

-- S-38 --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.users_self_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claims jsonb := coalesce(current_setting('request.jwt.claims', true)::jsonb, '{}'::jsonb);
  v_jwt_email text := lower(nullif(v_claims ->> 'email', ''));
BEGIN
  IF coalesce(v_claims ->> 'role', '') IN ('service_role', '') OR public.app_is_super_admin() THEN
    RETURN NEW;
  END IF;
  -- The email is the account's own sign-in email (or stays what it was).
  IF NEW.email IS NOT NULL
     AND lower(NEW.email) IS DISTINCT FROM v_jwt_email
     AND (TG_OP = 'INSERT' OR lower(NEW.email) IS DISTINCT FROM lower(OLD.email)) THEN
    RAISE EXCEPTION 'email must be the signed-in account''s own' USING ERRCODE = '42501';
  END IF;
  -- Fields only the server sets.
  IF TG_OP = 'INSERT' THEN
    NEW.email_verified := false;
    NEW.disabled := false;
    NEW.created_by_tenant_id := NULL;
  ELSE
    NEW.email_verified := OLD.email_verified;
    NEW.disabled := OLD.disabled;
    NEW.created_by_tenant_id := OLD.created_by_tenant_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.users_self_write_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS users_self_write_guard_trigger ON public.users;
CREATE TRIGGER users_self_write_guard_trigger
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_self_write_guard();
