-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Fix-A
-- (whole-branch review follow-up on Task 8 /
-- 20261212000000_permissions_and_billing_admin_gates.sql).
--
-- Task 8 added a settings.billing exemption to
-- tenants_no_self_billing_escalation's billing-field block: a caller WITH
-- app_has_permission('settings.billing') could edit billing-sensitive
-- tenants columns (subscription_end_date, trashed_at, trashed_by,
-- locked_at, purge_at, plan_id, etc) directly. The review found this was a
-- real security regression, not a feature: tenants_owner_update (RLS) only
-- lets owner_uid = app_current_uid() through to this trigger at all -- no
-- other staff member's UPDATE on tenants ever reaches it -- and
-- app_has_permission('settings.billing') short-circuits to true for
-- 'owner' before ever consulting the default-permission table (same
-- short-circuit as every other permission key, by design). Net effect:
-- Task 8's exemption applied to literally the one caller it must NOT apply
-- to, completely defeating the point of
-- 20261114000003_tenants_billing_defaults_and_self_edit_allowlist.sql,
-- which exists specifically to stop the owner from self-editing these
-- fraud-sensitive fields (fake-extending their own subscription, un-
-- trashing/un-locking their own tenant, etc).
--
-- The founder confirmed settings.billing was only ever meant to gate
-- BillingSettings.tsx's screen functionality, never these tenant-table
-- fields. BillingSettings.tsx's only write path is
-- create_subscription_request (confirmed by reading the component: it
-- only reads tenants/plans and calls createSubscriptionRequest() ->
-- supabase.rpc('create_subscription_request', ...)), which had ZERO role
-- or permission check before this fix (any tenant staff member -- cashier
-- included -- could submit a subscription/renewal request; this is BO-15
-- in cto-review-2026-11-13/17-billing-onboarding-settings.md,
-- "Subscription-request RPC has no role gate").
--
-- This migration:
--   1. Reverts tenants_no_self_billing_escalation to Task 8's version
--      MINUS the settings.billing exemption clause -- i.e. the exact
--      unconditional-block behavior 20261114000003 originally shipped.
--      Still SECURITY INVOKER (no SECURITY DEFINER), unchanged from both
--      Task 8 and 20261114000003 -- same reasoning both of those gave:
--      SECURITY DEFINER would make current_user always report this
--      function's OWNER instead of the real caller, making the
--      app_is_super_admin()/current_user IN ('postgres','service_role')
--      exemption meaningless.
--   2. Gives settings.billing its first real enforcement target: adds an
--      app_has_permission('settings.billing') check to
--      create_subscription_request, immediately after its existing
--      cross-tenant guard. Still SECURITY DEFINER, unchanged from
--      20261103000000 -- it legitimately needs it, since it writes
--      subscription_requests across the tenant-boundary check.
-- =============================================================================

-- -----------------------------------------------------------------------
-- 1) tenants_no_self_billing_escalation: revert to the unconditional block.
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

-- -----------------------------------------------------------------------
-- 2) create_subscription_request: add the settings.billing gate.
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_subscription_request(
  p_tenant_id      uuid,
  p_plan_id        text,
  p_payment_method text,
  p_proof_url      text DEFAULT NULL,
  p_reference_no   text DEFAULT NULL,
  p_notes          text DEFAULT NULL,
  p_coupon_code    text DEFAULT NULL,
  p_tenant_name    text DEFAULT NULL,
  p_tenant_email   text DEFAULT NULL
) RETURNS TABLE(id uuid, amount numeric, discount_amount numeric, original_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan_price       numeric;
  v_plan_name        text;
  v_coupon           public.coupons;
  v_coupon_id        uuid := NULL;
  v_coupon_code_norm text := NULL;
  v_discount         numeric := 0;
  v_row              public.subscription_requests;
BEGIN
  IF p_tenant_id IS DISTINCT FROM app_current_tenant_id() AND NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: can only request a subscription for your own tenant' USING ERRCODE = '42501';
  END IF;

  IF NOT public.app_has_permission('settings.billing') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إرسال طلب اشتراك/تجديد' USING ERRCODE = '42501';
  END IF;

  SELECT price, name INTO v_plan_price, v_plan_name FROM public.plans WHERE plans.id = p_plan_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'باقة غير صالحة أو غير مُفعّلة' USING ERRCODE = '22023';
  END IF;

  IF p_coupon_code IS NOT NULL AND trim(p_coupon_code) <> '' THEN
    v_coupon_code_norm := upper(trim(p_coupon_code));
    SELECT * INTO v_coupon FROM public.coupons WHERE code = v_coupon_code_norm FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'كود الخصم غير صحيح' USING ERRCODE = '22023';
    END IF;
    PERFORM public.assert_coupon_usable(v_coupon, p_tenant_id, p_plan_id);
    v_discount := public.compute_coupon_discount(v_coupon, v_plan_price);
    v_coupon_id := v_coupon.id;

    UPDATE public.coupons SET redemption_count = redemption_count + 1, updated_at = now() WHERE coupons.id = v_coupon.id;
  END IF;

  INSERT INTO public.subscription_requests (
    tenant_id, tenant_name, tenant_email, plan_id, plan_name, amount,
    original_amount, coupon_id, coupon_code, discount_amount,
    payment_method, proof_url, reference_no, notes
  ) VALUES (
    p_tenant_id, p_tenant_name, p_tenant_email, p_plan_id, v_plan_name, v_plan_price - v_discount,
    v_plan_price, v_coupon_id, v_coupon_code_norm, v_discount,
    p_payment_method, p_proof_url, p_reference_no, p_notes
  ) RETURNING * INTO v_row;

  RETURN QUERY SELECT v_row.id, v_row.amount, v_row.discount_amount, v_row.original_amount;
END;
$$;

REVOKE ALL ON FUNCTION public.create_subscription_request(uuid, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_subscription_request(uuid, text, text, text, text, text, text, text, text) TO authenticated;
