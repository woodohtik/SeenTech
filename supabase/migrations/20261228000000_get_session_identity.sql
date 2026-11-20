-- =============================================================================
-- seen-performance-first-open-login-task.md Phase 3: one round trip for the
-- signed-in person's identity instead of five in a row.
--
-- AuthContext.resolveIdentity used to read, one after another: users +
-- staff + saas_users, then users.photo_url, then (after a PATCH) staff with
-- tenant + tailor_requests + saas_users again, then the staff-with-PIN RPC.
-- This returns the same rows in one JSON object.
--
-- SECURITY INVOKER: every read below runs as the caller under the RLS that
-- already guards these tables -- this function grants nothing new. A row
-- the caller cannot see simply comes back null, exactly as the separate
-- PostgREST reads did. Nothing is written.
--
-- Shape (each key null when there is no such row):
--   user              public.users row of auth.uid() (photo_url = device session)
--   staff             the caller's staff row (active first, then oldest),
--                     same columns the client selected (never pin_hash)
--   tenant            that staff row's tenant
--   saas_user         { role, is_active }
--   tailor_request    the caller's tailor_requests row
--   referral_partner  { id, status }
--   role_key          roles.role_key when staff.role_id is set
--   has_staff_with_pin  whether any staff in that tenant has a PIN
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_session_identity()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text := auth.uid()::text;
  v_user jsonb;
  v_staff jsonb;
  v_tenant_id uuid;
  v_role_id uuid;
  v_tenant jsonb;
  v_saas jsonb;
  v_request jsonb;
  v_partner jsonb;
  v_role_key text;
  v_has_pin boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT to_jsonb(u) INTO v_user FROM public.users u WHERE u.id = v_uid;

  -- Explicit columns: pin_hash is not readable by the caller at all.
  SELECT jsonb_build_object(
           'id', s.id, 'uid', s.uid, 'name', s.name, 'email', s.email, 'phone', s.phone,
           'role', s.role, 'role_id', s.role_id, 'branch_id', s.branch_id, 'status', s.status,
           'must_change_pin', s.must_change_pin, 'is_test', s.is_test, 'tenant_id', s.tenant_id,
           'created_at', s.created_at, 'updated_at', s.updated_at,
           'commission_type', s.commission_type, 'commission_value', s.commission_value,
           'has_seen_onboarding', s.has_seen_onboarding, 'commission_balance', s.commission_balance,
           'has_pin', s.has_pin),
         s.tenant_id, s.role_id
    INTO v_staff, v_tenant_id, v_role_id
    FROM public.staff s
   WHERE s.uid = v_uid
   ORDER BY (s.status = 'active') DESC, s.created_at ASC
   LIMIT 1;

  IF v_tenant_id IS NOT NULL THEN
    SELECT to_jsonb(t) INTO v_tenant FROM public.tenants t WHERE t.id = v_tenant_id;
    BEGIN
      v_has_pin := EXISTS (SELECT 1 FROM public.staff_ids_with_pin_set(v_tenant_id));
    EXCEPTION WHEN OTHERS THEN
      -- staff_ids_with_pin_set refuses a tenant that is not the caller's
      -- current one; the old client call failed the same way and fell back
      -- to false.
      v_has_pin := false;
    END;
  END IF;

  IF v_role_id IS NOT NULL THEN
    SELECT r.role_key INTO v_role_key FROM public.roles r WHERE r.id = v_role_id;
  END IF;

  SELECT jsonb_build_object('role', su.role, 'is_active', su.is_active)
    INTO v_saas FROM public.saas_users su WHERE su.uid = v_uid;

  SELECT to_jsonb(tr) INTO v_request
    FROM public.tailor_requests tr WHERE tr.uid = v_uid
   ORDER BY tr.created_at ASC LIMIT 1;

  SELECT jsonb_build_object('id', rp.id, 'status', rp.status)
    INTO v_partner FROM public.referral_partners rp WHERE rp.uid = auth.uid();

  RETURN jsonb_build_object(
    'user', v_user,
    'staff', v_staff,
    'tenant', v_tenant,
    'saas_user', v_saas,
    'tailor_request', v_request,
    'referral_partner', v_partner,
    'role_key', v_role_key,
    'has_staff_with_pin', v_has_pin
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_session_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_session_identity() TO authenticated, service_role;
