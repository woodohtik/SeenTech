-- seen-readiness-fixes-task.md P6 (PLATFORM-10, -14, -15, -21) -- plans,
-- coupons, manual activation and referral rewards.
--
--  * The two base plans exist in every environment (they were only ever
--    seeded from a browser, which RLS refuses). Existing rows are untouched.
--  * The monthly order limit: NULL or 0 means no limit (0 blocked every order).
--  * A shop has one subscription request under review at a time, and uses a
--    coupon once (a rejected request gives it back, as before).
--  * A referral reward is credited when a subscription is PAID -- a row with
--    amount > 0 in saas_subscription_payments -- not on any change of status
--    to active (a free manual activation credited the referrer).
--  * admin_activate_plan(tenant, plan, amount, reason, method): the super
--    admin's manual activation, on the server, with its reason, its payment
--    (when there is one) in Seen's ledger, and a log line. It replaces a
--    direct UPDATE of tenants from the browser.
-- Rollback: supabase/rollbacks/20270109_plans_coupons_referrals.down.sql

INSERT INTO public.plans (id, name, price, features, max_staff, max_orders, is_active, billing_period) VALUES
  ('free',  'الباقة المجانية', 0,   '["تجربة 14 يوم", "عدد لا محدود من الفواتير", "بدون ربط بطاقة"]'::jsonb, 2, 100,   true, 'year'),
  ('basic', 'الخطة الأساسية',  999, '["إدارة العملاء", "إدارة الطلبات", "دعم فني"]'::jsonb,                 5, 50000, true, 'year')
ON CONFLICT (id) DO NOTHING;

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
  -- P6 (PLATFORM-14): no limit when the plan has none -- NULL or 0 (0 used
  -- to block every order).
  IF v_max_orders IS NULL OR v_max_orders <= 0 THEN
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

  -- P6 (PLATFORM-21): one request under review at a time.
  PERFORM pg_advisory_xact_lock(hashtext('subscription_request:' || p_tenant_id::text));
  IF EXISTS (SELECT 1 FROM public.subscription_requests sr WHERE sr.tenant_id = p_tenant_id AND sr.status = 'pending') THEN
    RAISE EXCEPTION 'لديك طلب اشتراك قيد المراجعة. انتظر الرد عليه قبل إرسال طلب جديد' USING ERRCODE = '22023';
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
    -- P6 (PLATFORM-21): a coupon is used once per shop (a rejected request gives it back).
    IF EXISTS (SELECT 1 FROM public.subscription_requests sr
                WHERE sr.tenant_id = p_tenant_id AND sr.coupon_id = v_coupon.id AND sr.status <> 'rejected') THEN
      RAISE EXCEPTION 'استخدمت كود الخصم هذا من قبل' USING ERRCODE = '22023';
    END IF;
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

CREATE UNIQUE INDEX IF NOT EXISTS subscription_requests_coupon_once_per_shop
  ON public.subscription_requests (coupon_id, tenant_id)
  WHERE coupon_id IS NOT NULL AND status <> 'rejected';

-- Referral rewards follow the money.
DROP TRIGGER IF EXISTS tenants_confirm_referral ON public.tenants;

CREATE OR REPLACE FUNCTION public.trg_confirm_referral_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.amount, 0) > 0 THEN
    PERFORM confirm_referral(NEW.tenant_id);
    BEGIN
      PERFORM confirm_partner_referral(NEW.tenant_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'confirm_partner_referral failed for tenant %: %', NEW.tenant_id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS saas_subscription_payments_confirm_referral ON public.saas_subscription_payments;
CREATE TRIGGER saas_subscription_payments_confirm_referral AFTER INSERT ON public.saas_subscription_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_confirm_referral_on_payment();

CREATE OR REPLACE FUNCTION public.admin_activate_plan(
  p_tenant_id uuid, p_plan_id text, p_amount numeric, p_reason text, p_payment_method text DEFAULT 'bank_transfer')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan   record;
  v_tenant record;
  v_start  timestamptz;
  v_end    timestamptz;
  v_amount numeric := round(COALESCE(p_amount, 0), 2);
  v_email  text;
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'سبب التفعيل اليدوي مطلوب' USING ERRCODE = '22023';
  END IF;
  IF v_amount < 0 OR v_amount > 1000000 THEN
    RAISE EXCEPTION 'المبلغ غير صالح' USING ERRCODE = '22023';
  END IF;
  SELECT id, name, price, COALESCE(billing_period, 'year') AS billing_period INTO v_plan FROM public.plans WHERE id = p_plan_id;
  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'باقة غير موجودة' USING ERRCODE = '22023';
  END IF;
  SELECT id, name, plan_id, subscription_end_date INTO v_tenant FROM public.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF v_tenant.id IS NULL THEN
    RAISE EXCEPTION 'المحل غير موجود' USING ERRCODE = '02000';
  END IF;

  IF COALESCE(v_plan.price, 0) <= 0 THEN
    -- A free plan: the plan changes, the subscription state stays as it is.
    IF v_amount > 0 THEN
      RAISE EXCEPTION 'لا مبلغ على باقة مجانية' USING ERRCODE = '22023';
    END IF;
    UPDATE public.tenants SET plan_id = p_plan_id, updated_at = now() WHERE id = p_tenant_id;
  ELSE
    v_start := GREATEST(now(), COALESCE(v_tenant.subscription_end_date, now()));
    v_end := v_start + CASE WHEN v_plan.billing_period = 'month' THEN interval '1 month' ELSE interval '1 year' END;
    UPDATE public.tenants
       SET plan_id = p_plan_id, status = 'active', subscription_status = 'active', is_trial = false,
           locked_at = NULL, purge_at = NULL, subscription_end_date = v_end, updated_at = now()
     WHERE id = p_tenant_id;
    IF v_amount > 0 THEN
      INSERT INTO public.saas_subscription_payments (tenant_id, plan_id, plan_name, amount, payment_method, reference, period_start, period_end)
      VALUES (p_tenant_id, p_plan_id, v_plan.name, v_amount, p_payment_method,
              'MANUAL-' || to_char(now(), 'YYYYMMDDHH24MISS'), v_start, v_end);
    END IF;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.saas_security_logs (user_id, user_email, action, details, occurred_at)
  VALUES (auth.uid()::text, v_email, 'activate_plan',
          format('tenant %s (%s): plan %s -> %s, amount %s, until %s, reason: %s',
                 p_tenant_id, v_tenant.name, v_tenant.plan_id, p_plan_id, v_amount, v_end, btrim(p_reason)), now());
  RETURN jsonb_build_object('plan_id', p_plan_id, 'subscription_end_date', v_end, 'amount', v_amount);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_activate_plan(uuid, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_activate_plan(uuid, text, numeric, text, text) TO authenticated;
