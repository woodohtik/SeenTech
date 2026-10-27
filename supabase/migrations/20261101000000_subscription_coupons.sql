-- =============================================================================
--  كوبونات خصم على اشتراك التاجر -- الموظف (سوبر أدمن) يُنشئ كود خصم (نسبة
--  أو مبلغ ثابت)، عام لكل التجّار أو مخصَّص لتاجر واحد بعينه (حسب ما قرره
--  المستخدم)، ثم يُعطيه للعميل. العميل يكتب الكود عند طلب الاشتراك/الترقية
--  في BillingSettings.tsx فيُطبَّق الخصم على سعر الباقة.
--  ------------------------------------------------------------------------
--  اكتُشِف أثناء هذا التصميم: createSubscriptionRequest (الخدمة الحالية)
--  تُدرِج مباشرة في subscription_requests عبر supabase.from(...).insert(...)
--  من المتصفح، و amount فيها قيمة يرسلها العميل بلا أي تحقق خادمي -- أي
--  تاجر يقدر يطلب باقة بـ599 ر.س ويرسل amount=1 اليوم بالفعل. هذا مقبول
--  جزئياً لأن سوبر أدمن يراجع كل طلب يدوياً قبل الموافقة (نفس الحماية التي
--  يعتمد عليها هذا النظام بالكامل، راجع 20260908050000_subscription_requests_table.sql)،
--  لكن بناء كوبونات فوق مسار يثق بما يرسله العميل يُفقِد الكوبون أي معنى
--  (تاجر يقدر يكتب أي amount/discount_amount/coupon_id مباشرة بلا كوبون
--  حقيقي إطلاقاً). create_subscription_request أدناه تحسب amount من
--  plans.price في الخادم دائماً (بكوبون أو بلا) وتستبدل الإدخال المباشر.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) جدول الكوبونات
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coupons (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL UNIQUE,
  discount_type        text NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value       numeric(12,2) NOT NULL CHECK (
                          (discount_type = 'percentage' AND discount_value > 0 AND discount_value <= 100)
                          OR (discount_type = 'fixed' AND discount_value > 0)
                        ),
  -- تاجر واحد فقط يقدر يستخدم هذا الكوبون؛ NULL = عام لكل التجّار.
  restricted_tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- يصلح لباقة واحدة فقط؛ NULL = يصلح لأي باقة.
  plan_id              text REFERENCES public.plans(id) ON DELETE SET NULL,
  max_redemptions      integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redemption_count     integer NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
  expires_at           timestamptz,
  is_active            boolean NOT NULL DEFAULT true,
  notes                text,
  created_by           text DEFAULT app_current_uid(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON public.coupons (code);
CREATE INDEX IF NOT EXISTS idx_coupons_restricted_tenant ON public.coupons (restricted_tenant_id);

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons FORCE ROW LEVEL SECURITY;

-- السوبر أدمن فقط يرى/يُنشئ/يعدّل/يحذف كوبونات (قرار مستخدم صريح). لا سياسة
-- SELECT للتاجر إطلاقاً -- تصفّح أكواد كوبونات غيره تسريب معلومة؛ التحقق من
-- كود بعينه يتم فقط عبر preview_coupon/create_subscription_request أدناه
-- (SECURITY DEFINER، يتجاوزان RLS كمالكي الدوال).
DROP POLICY IF EXISTS coupons_super_admin_all ON public.coupons;
CREATE POLICY coupons_super_admin_all ON public.coupons FOR ALL TO authenticated
  USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());

-- -----------------------------------------------------------------------------
-- 2) دالتا تحقق/حساب داخليتان مشتركتان بين preview_coupon (قراءة فقط، بلا
--    قفل) و create_subscription_request (تطبيق فعلي، بقفل FOR UPDATE) --
--    بدل تكرار نفس سلسلة RAISE EXCEPTION مرتين.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_coupon_usable(
  p_coupon public.coupons,
  p_tenant_id uuid,
  p_plan_id text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_coupon.is_active THEN
    RAISE EXCEPTION 'كود الخصم غير مُفعّل' USING ERRCODE = '22023';
  END IF;
  IF p_coupon.expires_at IS NOT NULL AND p_coupon.expires_at < now() THEN
    RAISE EXCEPTION 'كود الخصم منتهي الصلاحية' USING ERRCODE = '22023';
  END IF;
  IF p_coupon.restricted_tenant_id IS NOT NULL AND p_coupon.restricted_tenant_id <> p_tenant_id THEN
    RAISE EXCEPTION 'كود الخصم غير صالح لهذا الحساب' USING ERRCODE = '22023';
  END IF;
  IF p_coupon.plan_id IS NOT NULL AND p_coupon.plan_id <> p_plan_id THEN
    RAISE EXCEPTION 'كود الخصم غير صالح لهذه الباقة' USING ERRCODE = '22023';
  END IF;
  IF p_coupon.max_redemptions IS NOT NULL AND p_coupon.redemption_count >= p_coupon.max_redemptions THEN
    RAISE EXCEPTION 'تم استخدام كود الخصم هذا بالكامل' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_coupon_usable(public.coupons, uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.compute_coupon_discount(
  p_coupon public.coupons,
  p_plan_price numeric
) RETURNS numeric LANGUAGE sql AS $$
  SELECT LEAST(
    CASE WHEN p_coupon.discount_type = 'percentage'
      THEN round(p_plan_price * p_coupon.discount_value / 100, 2)
      ELSE p_coupon.discount_value
    END,
    p_plan_price
  );
$$;
REVOKE ALL ON FUNCTION public.compute_coupon_discount(public.coupons, numeric) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 3) preview_coupon: معاينة الخصم قبل الإرسال (بلا قفل، بلا أي تعديل) --
--    تُستخدَم في BillingSettings.tsx لعرض السعر بعد الخصم فور كتابة الكود.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_coupon(
  p_code text,
  p_tenant_id uuid,
  p_plan_id text
) RETURNS TABLE(discount_amount numeric, final_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan_price numeric;
  v_coupon     public.coupons;
  v_discount   numeric;
BEGIN
  IF p_tenant_id IS DISTINCT FROM app_current_tenant_id() AND NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT price INTO v_plan_price FROM public.plans WHERE id = p_plan_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'باقة غير صالحة' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_coupon FROM public.coupons WHERE code = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'كود الخصم غير صحيح' USING ERRCODE = '22023';
  END IF;

  PERFORM public.assert_coupon_usable(v_coupon, p_tenant_id, p_plan_id);
  v_discount := public.compute_coupon_discount(v_coupon, v_plan_price);

  RETURN QUERY SELECT v_discount, v_plan_price - v_discount;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_coupon(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_coupon(text, uuid, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4) أعمدة جديدة على subscription_requests لتسجيل الكوبون المطبَّق (إن
--    وُجد) + السعر الأصلي قبل الخصم، لعرضهما في شاشة مراجعة السوبر أدمن.
-- -----------------------------------------------------------------------------
ALTER TABLE public.subscription_requests
  ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_amount numeric(12,2);

UPDATE public.subscription_requests SET original_amount = amount WHERE original_amount IS NULL;

-- الإدخال المباشر من العميل كان يسمح بتزييف amount (وسيسمح بتزييف
-- discount_amount/coupon_id الجديدين أيضاً) بلا أي تحقق -- أُلغيت سياسة
-- الإدخال المباشر؛ الإنشاء الآن حصراً عبر create_subscription_request()
-- أدناه (SECURITY DEFINER، تتجاوز RLS كمالكة الدالة، تحسب amount من
-- plans.price دوماً).
DROP POLICY IF EXISTS subscription_requests_tenant_insert ON public.subscription_requests;

-- -----------------------------------------------------------------------------
-- 5) create_subscription_request: تُنشئ طلب الاشتراك، وتطبّق + تَحجز كوبوناً
--    (FOR UPDATE، تزيد redemption_count فوراً) إن أُرسِل كود صالح.
-- -----------------------------------------------------------------------------
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
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan_price       numeric;
  v_plan_name        text;
  v_coupon           public.coupons;
  v_coupon_id        uuid := NULL;
  v_coupon_code_norm text := NULL;
  v_discount         numeric := 0;
  v_req_id           uuid;
BEGIN
  IF p_tenant_id IS DISTINCT FROM app_current_tenant_id() AND NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: can only request a subscription for your own tenant' USING ERRCODE = '42501';
  END IF;

  SELECT price, name INTO v_plan_price, v_plan_name FROM public.plans WHERE id = p_plan_id AND is_active = true;
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

    UPDATE public.coupons SET redemption_count = redemption_count + 1, updated_at = now() WHERE id = v_coupon.id;
  END IF;

  INSERT INTO public.subscription_requests (
    tenant_id, tenant_name, tenant_email, plan_id, plan_name, amount,
    original_amount, coupon_id, coupon_code, discount_amount,
    payment_method, proof_url, reference_no, notes
  ) VALUES (
    p_tenant_id, p_tenant_name, p_tenant_email, p_plan_id, v_plan_name, v_plan_price - v_discount,
    v_plan_price, v_coupon_id, v_coupon_code_norm, v_discount,
    p_payment_method, p_proof_url, p_reference_no, p_notes
  ) RETURNING id INTO v_req_id;

  RETURN v_req_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_subscription_request(uuid, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_subscription_request(uuid, text, text, text, text, text, text, text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6) reject_subscription_request: تُعاد نفس الدالة لتحرير حجز الكوبون
--    (تنقيص redemption_count) عند رفض الطلب، فيقدر العميل يحاول مجدداً.
--    السلوك الآخر (القفل، التحقق من pending) بلا تغيير.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_subscription_request(
  p_request_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req public.subscription_requests;
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.subscription_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription request not found' USING ERRCODE = '02000';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'already_processed: request is already %', v_req.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.subscription_requests
     SET status = 'rejected', rejection_reason = p_reason, updated_at = now()
   WHERE id = p_request_id;

  IF v_req.coupon_id IS NOT NULL THEN
    UPDATE public.coupons SET redemption_count = GREATEST(redemption_count - 1, 0), updated_at = now()
     WHERE id = v_req.coupon_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_subscription_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_subscription_request(uuid, text) TO authenticated, service_role;
