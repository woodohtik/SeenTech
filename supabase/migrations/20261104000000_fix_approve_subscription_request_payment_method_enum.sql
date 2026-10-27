-- =============================================================================
--  إصلاح: "column "method" is of type payment_method but expression is of
--  type text" عند اعتماد أي طلب اشتراك.
--  ------------------------------------------------------------------------
--  subscription_requests.payment_method عمود text عادي (قيمه من الواجهة:
--  bank_transfer/card/network/cash)، بينما payments.method من نوع ENUM
--  payment_method (قيمه: cash/network/bank_transfer/cash_on_delivery/
--  partial -- بلا 'card' إطلاقاً). الإدراج المباشر بلا تحويل كان يفشل
--  دوماً؛ خلل قديم لم يظهر قبل اليوم لأن شاشة اعتماد الطلبات نفسها لم تكن
--  موصولة بأي رابط في الواجهة حتى الآن. 'card' (دفع إلكتروني مباشر) تُحوَّل
--  لأقرب قيمة متاحة في الـenum (network، نفس معنى "دفع بالبطاقة" في باقي
--  النظام)؛ أي قيمة أخرى تمر كما هي لأنها متطابقة فعلاً مع الـenum.
--  ------------------------------------------------------------------------
--  كما استُبدِلت "السوبر أدمن" في ملاحظة الدفعة بـ"فريق سين" -- هذه
--  الملاحظة تظهر فعلياً في سجل مدفوعات التاجر (BillingSettings.tsx)، فهي
--  نص يواجه العميل لا تعليقاً داخلياً.
-- =============================================================================

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
