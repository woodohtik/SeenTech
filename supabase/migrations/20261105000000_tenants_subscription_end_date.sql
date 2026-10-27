-- =============================================================================
--  إصلاح: "تم قبول الطلب لكن لم يتم اضافة مدة التجديد للعميل".
--  ------------------------------------------------------------------------
--  فحص حي لـinformation_schema.columns هذه الجلسة أكّد أن tenants لا يملك
--  أي عمود subscription_end_date إطلاقاً -- BillingSettings.tsx يقرأ
--  tenant.subscription_end_date منذ البداية (getNextBillingDate) لكنه كان
--  يرجع undefined دوماً فيسقط على تاريخ وهمي (created_at + سنة)، لا تاريخاً
--  حقيقياً مرتبطاً بآخر اعتماد فعلي. approve_subscription_request كانت
--  تُفعّل الباقة (status/subscription_status/is_trial) بلا أي تمديد فعلي
--  لمدة الاشتراك.
--
--  هذا الملف: (1) يضيف العمود الذي تتوقّعه الواجهة فعلاً، (2) يمدّد سنة
--  واحدة من الأبعد بين الآن وتاريخ الانتهاء الحالي (لا يُضيّع أياماً متبقية
--  عند تجديد مبكر، ولا يسمح بتراكم غير محدود لو تكرّر الاعتماد سهواً).
-- =============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS subscription_end_date timestamptz;

CREATE OR REPLACE FUNCTION public.approve_subscription_request(
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req record;
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.subscription_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req IS NULL THEN
    RAISE EXCEPTION 'subscription request not found' USING ERRCODE = '02000';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'already_processed: request is already %', v_req.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.subscription_requests
     SET status = 'approved', updated_at = now()
   WHERE id = p_request_id;

  UPDATE public.tenants
     SET plan_id = v_req.plan_id,
         status = 'active',
         subscription_status = 'active',
         is_trial = false,
         locked_at = NULL,
         purge_at = NULL,
         subscription_end_date = GREATEST(now(), COALESCE(tenants.subscription_end_date, now())) + interval '1 year',
         updated_at = now()
   WHERE id = v_req.tenant_id;

  IF v_req.plan_id = 'basic' THEN
    INSERT INTO public.payments (tenant_id, amount, method, received_at, notes, reference)
    VALUES (
      v_req.tenant_id,
      v_req.amount,
      (CASE v_req.payment_method WHEN 'card' THEN 'network' ELSE v_req.payment_method END)::payment_method,
      now(),
      'سداد وتفعيل اشتراك الباقة الأساسية (معتمد من فريق سين)',
      COALESCE(v_req.reference_no, 'APPROVED-' || to_char(now(), 'YYYYMMDDHH24MISS'))
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_subscription_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_subscription_request(uuid) TO authenticated, service_role;
