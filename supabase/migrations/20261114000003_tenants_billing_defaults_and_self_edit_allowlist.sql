-- seen-cto-sprint0-critical-fixes-task.md item 4 (BO-01, BO-04).
--
-- Confirmed real, not theoretical: Login.tsx:466-478's signup INSERT is a
-- plain client call -- `plan_id: 'free'` is the honest value today, but
-- nothing stops a tampered request from sending `plan_id: '<paid plan>'`,
-- `status: 'active'`, `subscription_end_date: '2099-01-01'`, etc. directly
-- in the same INSERT payload. There is no limits/`max_*` column on
-- `tenants` itself (checked the live schema) and no separate
-- `features`/`modules` column beyond `enabled_modules`, already covered.

-- -----------------------------------------------------------------------
-- 1) BEFORE INSERT: force safe billing defaults, whatever the browser
--    sent, for anyone except service_role/postgres (seed/migration
--    scripts) and super_admin (admin-created tenants via
--    AdminTenantLicenses.tsx or similar). Deliberately does NOT touch
--    status/name/phone/owner_uid/etc -- those are not financial and
--    Login.tsx's own INSERT (status: 'active') must keep working exactly
--    as today.
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tenants_force_safe_billing_defaults() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF app_is_super_admin() OR current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;

  NEW.plan_id := 'free';
  NEW.subscription_status := 'trial';
  NEW.is_trial := true;
  NEW.trial_started_at := now();
  NEW.trial_ends_at := now() + interval '14 days';
  NEW.subscription_end_date := NULL;
  NEW.trashed_at := NULL;
  NEW.trashed_by := NULL;
  NEW.locked_at := NULL;
  NEW.purge_at := NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_force_safe_billing_defaults_trigger ON public.tenants;
CREATE TRIGGER tenants_force_safe_billing_defaults_trigger
BEFORE INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenants_force_safe_billing_defaults();

-- -----------------------------------------------------------------------
-- 2) tenants_no_self_billing_escalation, converted from a deny-list (which
--    missed subscription_end_date/trashed_at/trashed_by -- added by later
--    migrations after the original deny-list was written, and never
--    backfilled into it) to an explicit allow-list: anything not named
--    here is rejected for a self-edit, including any future billing-
--    shaped column added later. The allow-list is exactly the "commercial
--    profile" columns Onboarding.tsx's own tenant self-update
--    (src/components/Onboarding.tsx:391-403, the only real self-edit call
--    site in src/ -- confirmed via grep) actually writes, plus a few
--    clearly non-financial siblings already on the table (vat_number,
--    commercial_register, city, postal_code, measurement_unit).
--
--    Also fixes DB1-05: the previous version had no service_role/postgres
--    exemption at all, so trial_lock_sweep/trial_purge_sweep/slg_sweep
--    (scheduled jobs touching trial_started_at/trial_ends_at/locked_at/
--    purge_at) failed with this trigger's own permission error every time
--    they ran. Not marked SECURITY DEFINER (same reasoning as
--    prevent_tax_invoice_tamper's own fix, 20260920020000): SECURITY
--    DEFINER would make current_user always report this function's OWNER
--    instead of the real caller, making the current_user check below
--    meaningless.
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

  IF v_allowed_new IS DISTINCT FROM NEW THEN
    RAISE EXCEPTION 'يمكن للمالك تعديل بيانات الملف التجاري فقط -- أي تعديل آخر (الباقة، حالة الاشتراك، التجربة، الحذف، الملكية) يتطلب مساراً إدارياً'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_no_self_billing_escalation_trigger ON public.tenants;
CREATE TRIGGER tenants_no_self_billing_escalation_trigger
BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenants_no_self_billing_escalation();
