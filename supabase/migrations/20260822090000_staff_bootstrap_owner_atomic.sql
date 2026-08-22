-- B-1 (security-fix-tasklist.md): "staff_onboarding_insert" only checked
-- uid = app_current_uid() -- any authenticated user could insert a staff
-- row for ANY tenant_id with role='owner' and it would pass RLS outright,
-- self-appointing as owner of somebody else's store.
--
-- ForcePinSetup.tsx's "first user of a tenant becomes owner" flow did its
-- own check-then-insert (SELECT count(*) ... then .insert(...)) entirely
-- client-side with no atomicity and no server-side enforcement -- the RLS
-- policy never actually verified "this tenant currently has zero staff"
-- before allowing an owner-role insert.
--
-- Fix: a SECURITY DEFINER function does the zero-staff check and the
-- insert in one atomic statement, and the raw INSERT policy is tightened
-- so a direct client insert can never set role to 'owner' or 'admin'.

CREATE OR REPLACE FUNCTION bootstrap_tenant_owner(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_count int;
  cur_uid text;
BEGIN
  cur_uid := app_current_uid();
  IF cur_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT count(*) INTO existing_count FROM staff WHERE tenant_id = p_tenant_id;
  IF existing_count > 0 THEN
    RAISE EXCEPTION 'tenant already has staff -- cannot self-bootstrap as owner';
  END IF;

  INSERT INTO staff (uid, tenant_id, role, status, name, email, phone, created_at)
  SELECT
    cur_uid,
    p_tenant_id,
    'owner',
    'active',
    COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb -> 'user_metadata' ->> 'full_name', ''), t.name, 'مالك المتجر'),
    COALESCE(t.owner_email::text, ''),
    COALESCE(t.phone, ''),
    now()
  FROM tenants t
  WHERE t.id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION bootstrap_tenant_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bootstrap_tenant_owner(uuid) TO authenticated;

-- Direct inserts into staff can still self-register (e.g. subsequent
-- cashiers), just never with an owner/admin role -- that path now only
-- exists through the atomic function above.
DROP POLICY IF EXISTS "staff_onboarding_insert" ON staff;
CREATE POLICY "staff_onboarding_insert" ON staff
    FOR INSERT WITH CHECK (
      app_is_super_admin()
      OR (uid = app_current_uid() AND role NOT IN ('owner', 'admin'))
    );
