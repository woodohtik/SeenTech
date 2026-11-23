-- Rollback of 20270106000003_renewal_and_purge_safety.sql
DROP POLICY IF EXISTS subscription_requests_tenant_read ON public.subscription_requests;
CREATE POLICY subscription_requests_tenant_read ON public.subscription_requests FOR SELECT TO authenticated
  USING (app_is_super_admin() OR (tenant_id = app_current_tenant_id()));
DROP POLICY IF EXISTS saas_subscription_payments_read ON public.saas_subscription_payments;
CREATE POLICY saas_subscription_payments_read ON public.saas_subscription_payments FOR SELECT TO authenticated
  USING (app_is_super_admin() OR (tenant_id = app_current_tenant_id()
         AND (app_has_permission('settings.billing'::text) OR app_has_permission('settings.view'::text))));
CREATE OR REPLACE FUNCTION public.trial_lock_sweep()
 RETURNS void
 LANGUAGE sql
AS $function$
  UPDATE tenants SET subscription_status='locked', locked_at=now(), purge_at=now() + interval '30 days'
  WHERE (subscription_status = 'trial' AND trial_ends_at IS NOT NULL AND trial_ends_at < now())
     OR (subscription_status = 'active' AND subscription_end_date IS NOT NULL AND subscription_end_date < now());
$function$;
CREATE OR REPLACE FUNCTION public.create_subscription_request(p_tenant_id uuid, p_plan_id text, p_payment_method text, p_proof_url text DEFAULT NULL::text, p_reference_no text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_coupon_code text DEFAULT NULL::text, p_tenant_name text DEFAULT NULL::text, p_tenant_email text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, amount numeric, discount_amount numeric, original_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.trial_purge_sweep()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM tenants
           WHERE subscription_status = 'locked' AND is_trial = true
             AND purge_at IS NOT NULL AND purge_at < now()
  LOOP
    DELETE FROM orders            WHERE tenant_id = r.id;
    DELETE FROM customers         WHERE tenant_id = r.id;
    DELETE FROM inventory_items   WHERE tenant_id = r.id;
    DELETE FROM staff             WHERE tenant_id = r.id;
    DELETE FROM branches          WHERE tenant_id = r.id;
    UPDATE tenants SET subscription_status='purge_pending', is_trial=false WHERE id = r.id;
    UPDATE leads SET status='lost' WHERE tenant_id = r.id AND status NOT IN ('paid');
  END LOOP;
END; $function$
;

CREATE OR REPLACE FUNCTION public.app_current_tenant_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    t_id UUID;
    cur_uid TEXT;
    t_status TEXT;
    t_trashed_at TIMESTAMPTZ;
    t_sub_status TEXT;
    t_sub_end TIMESTAMPTZ;
BEGIN
    cur_uid := app_current_uid();
    IF cur_uid IS NULL THEN RETURN NULL; END IF;

    -- 1. Check if user is staff (Owner is often also staff). Deterministic
    -- order: a user can hold more than one active staff row (across
    -- tenants); always resolve to the earliest one.
    SELECT tenant_id INTO t_id FROM staff
     WHERE uid = cur_uid AND status = 'active'
     ORDER BY created_at ASC
     LIMIT 1;

    -- 2. Check if user is owner directly from tenants table
    IF t_id IS NULL THEN
        SELECT id INTO t_id FROM tenants
         WHERE owner_uid = cur_uid
         ORDER BY created_at ASC
         LIMIT 1;
    END IF;

    IF t_id IS NULL THEN RETURN NULL; END IF;

    -- 3. Inactive, trashed, locked/purge_pending, or an expired paid term:
    -- every RLS policy keyed on this function stops matching any row for
    -- them, owner and staff alike.
    SELECT status, trashed_at, subscription_status, subscription_end_date
      INTO t_status, t_trashed_at, t_sub_status, t_sub_end
      FROM tenants WHERE id = t_id;

    IF t_status = 'inactive' THEN
        RETURN NULL;
    END IF;

    IF t_trashed_at IS NOT NULL THEN
        RETURN NULL;
    END IF;

    IF t_sub_status IN ('locked', 'purge_pending') THEN
        RETURN NULL;
    END IF;

    IF t_sub_end IS NOT NULL AND t_sub_end < now() THEN
        RETURN NULL;
    END IF;

    RETURN t_id;
END;
$function$;
DROP FUNCTION IF EXISTS public.app_is_tenant_owner(uuid);
