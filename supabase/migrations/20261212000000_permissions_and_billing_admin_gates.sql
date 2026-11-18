-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Task 8
-- (final task of the plan).
--
-- Two halves:
--
-- 1) roles_tenant_insert / roles_tenant_update (public.roles) and
--    user_permission_overrides_tenant_insert / _tenant_update
--    (public.user_permission_overrides): gated on staff.permissions via
--    app_has_permission() (Task 1) instead of:
--      - roles_tenant_insert/roles_tenant_update's hard-coded
--        app_current_role() IN ('owner', 'admin')
--        (20260909080000_roles_admin_only_write.sql).
--      - user_permission_overrides_tenant_insert/_tenant_update's bare
--        tenant_id = app_current_tenant_id() with NO role/permission
--        predicate at all -- the generic %I_tenant_insert/%I_tenant_update
--        form from the tenant_tables loop in
--        20240601000000_track_base_schema.sql, never overridden for this
--        table before now, confirmed by grepping every migration for
--        "user_permission_overrides_tenant" (no hits besides the base
--        schema) before writing this DROP POLICY.
--    Both policy names independently confirmed against migration history
--    before use here (same discipline as Tasks 6-7): roles_tenant_insert/
--    roles_tenant_update last touched by 20260909080000 and never renamed
--    since; user_permission_overrides_tenant_insert/_update never touched
--    since the base-schema generic loop.
--
-- 2) tenants_no_self_billing_escalation (originally
--    20260908040000_tenants_no_self_billing_escalation.sql, rewritten as
--    an explicit commercial-profile allow-list by
--    20261114000003_tenants_billing_defaults_and_self_edit_allowlist.sql):
--    today it unconditionally blocks ANY self-edit outside that allow-list
--    (name/phone/address/city/postal_code/vat_number/commercial_register/
--    logo_url/default_layout/inventory_strategy/is_tax_enabled/
--    default_tax_rate/measurement_unit/vertical/updated_at) for anyone
--    except app_is_super_admin()/current_user IN
--    ('postgres', 'service_role') -- there is no permission check at all,
--    it is a flat block. This adds a settings.billing escape hatch: only
--    when the caller LACKS app_has_permission('settings.billing') does an
--    out-of-allow-list change (e.g. plan_id) still raise the existing
--    exception, verbatim message unchanged. 'owner' passes via
--    app_has_permission's own short-circuit (true for 'owner' before ever
--    consulting the default-permission table), matching the plan's
--    scenario that owner must keep working exactly as today.
--
--    Function stays SECURITY INVOKER -- no SECURITY DEFINER clause is
--    added, matching 20261114000003's own comment on this function:
--    "SECURITY DEFINER would make current_user always report this
--    function's OWNER instead of the real caller, making the current_user
--    check below meaningless." That reasoning is exactly why
--    app_has_permission() (itself SECURITY DEFINER, but keyed off
--    auth.uid()-derived helpers rather than current_user) is safe to call
--    from here: it does not change how current_user resolves inside this
--    trigger, so the app_is_super_admin()/current_user IN
--    ('postgres','service_role') exemption above it is untouched and
--    still means what it says.
-- =============================================================================

-- -----------------------------------------------------------------------
-- Half 1: roles / user_permission_overrides write gates
-- -----------------------------------------------------------------------

DROP POLICY IF EXISTS roles_tenant_insert ON public.roles;
CREATE POLICY roles_tenant_insert ON public.roles
  FOR INSERT TO authenticated
  WITH CHECK (
    app_is_super_admin()
    OR (tenant_id = app_current_tenant_id() AND app_has_permission('staff.permissions'))
  );

DROP POLICY IF EXISTS roles_tenant_update ON public.roles;
CREATE POLICY roles_tenant_update ON public.roles
  FOR UPDATE TO authenticated
  USING (
    app_is_super_admin()
    OR (tenant_id = app_current_tenant_id() AND app_has_permission('staff.permissions'))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (tenant_id = app_current_tenant_id() AND app_has_permission('staff.permissions'))
  );

DROP POLICY IF EXISTS user_permission_overrides_tenant_insert ON public.user_permission_overrides;
CREATE POLICY user_permission_overrides_tenant_insert ON public.user_permission_overrides
  FOR INSERT WITH CHECK (
    app_is_super_admin()
    OR (tenant_id = app_current_tenant_id() AND app_has_permission('staff.permissions'))
  );

DROP POLICY IF EXISTS user_permission_overrides_tenant_update ON public.user_permission_overrides;
CREATE POLICY user_permission_overrides_tenant_update ON public.user_permission_overrides
  FOR UPDATE USING (
    app_is_super_admin()
    OR (tenant_id = app_current_tenant_id() AND app_has_permission('staff.permissions'))
  )
  WITH CHECK (
    app_is_super_admin()
    OR (tenant_id = app_current_tenant_id() AND app_has_permission('staff.permissions'))
  );

-- -----------------------------------------------------------------------
-- Half 2: tenants_no_self_billing_escalation settings.billing gate
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tenants_no_self_billing_escalation() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_allowed_new tenants;
BEGIN
  IF app_is_super_admin() OR current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- Start from OLD, then overlay only the columns a self-edit may change.
  -- Anything else that differs between NEW and this constructed row means
  -- the caller touched a column outside the allow-list.
  v_allowed_new := OLD;
  v_allowed_new.name                := NEW.name;
  v_allowed_new.phone               := NEW.phone;
  v_allowed_new.address             := NEW.address;
  v_allowed_new.city                := NEW.city;
  v_allowed_new.postal_code         := NEW.postal_code;
  v_allowed_new.vat_number          := NEW.vat_number;
  v_allowed_new.commercial_register := NEW.commercial_register;
  v_allowed_new.logo_url            := NEW.logo_url;
  v_allowed_new.default_layout      := NEW.default_layout;
  v_allowed_new.inventory_strategy  := NEW.inventory_strategy;
  v_allowed_new.is_tax_enabled      := NEW.is_tax_enabled;
  v_allowed_new.default_tax_rate    := NEW.default_tax_rate;
  v_allowed_new.measurement_unit    := NEW.measurement_unit;
  v_allowed_new.vertical            := NEW.vertical;
  v_allowed_new.updated_at          := NEW.updated_at;

  -- Only a caller WITHOUT settings.billing still has to stay inside the
  -- commercial-profile allow-list; app_has_permission('settings.billing')
  -- short-circuits to true for 'owner' and app_is_super_admin() (already
  -- exempted above), so this only ever actually gates staff with a
  -- role/override that does not grant settings.billing.
  IF v_allowed_new IS DISTINCT FROM NEW AND NOT public.app_has_permission('settings.billing') THEN
    RAISE EXCEPTION 'يمكن للمالك تعديل بيانات الملف التجاري فقط -- أي تعديل آخر (الباقة، حالة الاشتراك، التجربة، الحذف، الملكية) يتطلب مساراً إدارياً'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
