-- =============================================================================
--  إصلاح: "column reference "id" is ambiguous" عند إرسال أي طلب اشتراك/تجديد
--  (حتى بلا كوبون إطلاقاً).
--  ------------------------------------------------------------------------
--  create_subscription_request's RETURNS TABLE(id uuid, amount numeric, ...)
--  ينشئ متغيّر PL/pgSQL ضمنياً باسم "id" مرئياً في كل الدالة -- أي إشارة
--  غير مؤهَّلة لعمود id (plans.id في أول استعلام، coupons.id عند تطبيق
--  كوبون) تصبح غامضة بين عمود الجدول ومتغيّر الإرجاع الضمني، فتفشل الدالة
--  فوراً عند أول SELECT فيها، بلا علاقة بوجود كوبون من الأساس.
-- =============================================================================

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
