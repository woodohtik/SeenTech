-- =============================================================================
--  إصلاح: التجديد كان يمدّد سنة من "الآن" دوماً عند أول اعتماد لأي مستأجر
--  (COALESCE(subscription_end_date, now()) -- العمود جديد، فكل مستأجر حالي
--  قيمته فيه NULL). لو جدّد مستأجر قبل انتهاء دورته الحالية بوقت طويل (مثل
--  "noman Store": created_at 2026-08-30، أي دورته الحالية تنتهي منطقياً
--  2027-08-30، لكنه جدّد اليوم 2026-10-27)، كان هذا يقصّر مدته الفعلية
--  بنحو 10 أشهر بدل إضافة سنة كاملة فوق ما تبقّى له.
--
--  الأساس الصحيح عند عدم وجود subscription_end_date سابق هو تقدير الدورة
--  الحالية فعلياً (created_at + سنة -- نفس الافتراض الذي اعتمدته الواجهة
--  دوماً في getNextBillingDate قبل هذا الإصلاح)، لا "الآن". GREATEST مع
--  now() يبقى ضرورياً فقط لحماية مستأجر متأخر تاريخه التقديري ماضٍ بعيد.
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
         subscription_end_date = GREATEST(
           now(),
           COALESCE(tenants.subscription_end_date, tenants.created_at + interval '1 year')
         ) + interval '1 year',
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
