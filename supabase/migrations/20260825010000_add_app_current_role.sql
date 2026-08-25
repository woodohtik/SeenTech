-- record_uom_conversion() (fabric UoM conversion RPC) calls
-- public.app_current_role() to gate the operation to staff/owner roles, but
-- that helper was never created -- every call fails with 42883 (function
-- does not exist), which is why the fabric-calibration tab still shows a
-- "coming soon" placeholder instead of the fully-built UI behind it.
--
-- Mirrors app_current_staff_id()'s lookup convention, with the same
-- owner-without-a-staff-row fallback app_current_tenant_id() uses (a tenant
-- owner is normally also a staff row via signup, but this keeps the two
-- helpers consistent instead of assuming that always holds).
CREATE OR REPLACE FUNCTION public.app_current_role()
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cur_uid TEXT;
  r TEXT;
BEGIN
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
