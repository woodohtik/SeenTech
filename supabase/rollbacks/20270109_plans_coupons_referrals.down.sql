-- Rollback of 20270109000000_plans_coupons_referrals.sql (seeded plans and the index are kept)
DROP FUNCTION IF EXISTS public.admin_activate_plan(uuid, text, numeric, text, text);
DROP TRIGGER IF EXISTS saas_subscription_payments_confirm_referral ON public.saas_subscription_payments;
DROP FUNCTION IF EXISTS public.trg_confirm_referral_on_payment();
CREATE TRIGGER tenants_confirm_referral AFTER UPDATE OF subscription_status ON public.tenants FOR EACH ROW EXECUTE FUNCTION trg_confirm_referral();
DROP INDEX IF EXISTS public.subscription_requests_coupon_once_per_shop;
CREATE OR REPLACE FUNCTION public.enforce_orders_plan_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id    text;
  v_max_orders int;
  v_current    int;
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  SELECT plan_id INTO v_plan_id FROM public.tenants WHERE id = NEW.tenant_id;
  IF v_plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT max_orders INTO v_max_orders FROM public.plans WHERE id = v_plan_id;
  IF v_max_orders IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_current
    FROM public.orders
   WHERE tenant_id = NEW.tenant_id
     AND status <> 'cancelled'
     AND order_date >= date_trunc('month', now());

  IF v_current >= v_max_orders THEN
    -- Kept short (<100 chars) on purpose: getFriendlyErrorMessage
    -- (src/lib/firebase.ts) passes a Postgres error message straight
    -- through to the toast only below that length, else it falls back
    -- to a fully generic message.
    RAISE EXCEPTION 'تجاوزت باقتك الحد الأقصى لعدد الطلبات الشهرية (%)', v_max_orders
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$
;

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
  -- P5 (PLATFORM-02): the owner of a locked shop can still renew it --
  -- app_current_tenant_id() is NULL for a locked shop, so this used to refuse
  -- exactly the people who needed it.
  IF NOT app_is_super_admin() AND NOT public.app_is_tenant_owner(p_tenant_id) THEN
    IF p_tenant_id IS DISTINCT FROM app_current_tenant_id() THEN
      RAISE EXCEPTION 'Forbidden: can only request a subscription for your own tenant' USING ERRCODE = '42501';
    END IF;
    IF NOT public.app_has_permission('settings.billing') THEN
      RAISE EXCEPTION 'لا تملك صلاحية إرسال طلب اشتراك/تجديد' USING ERRCODE = '42501';
    END IF;
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
