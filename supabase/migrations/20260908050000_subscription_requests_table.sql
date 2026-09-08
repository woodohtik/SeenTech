-- =============================================================================
--  اعتماد/رفض طلب اشتراك عبر جدول وRPC حقيقيين بدل localStorage + كتابة مباشرة
--  (seen-comprehensive-review-fixes-task.md, بند 2.4)
--  ------------------------------------------------------------------------
--  subscriptionRequestService.ts القديم: حالة الطلب (pending/approved/
--  rejected) تعيش في localStorage على متصفح المسؤول فقط، فاعتماد من جهاز
--  ثانٍ لا يرى أن الطلب اعتُمِد أصلاً -- سباق اعتماد مزدوج حقيقي. كذلك
--  الاعتماد كان يكتب مباشرة على tenants (بلا RPC، بلا معاملة واحدة، والخطأ
--  يُبتلَع بـ console.error فقط) عبر عمود subscription_end_date **غير
--  موجود فعلياً على tenants** (تحقّق حي من information_schema.columns هذه
--  الجلسة) -- أي أن تفعيل الاشتراك كان يفشل بصمت في كل مرة أصلاً.
--
--  هذا الملف: جدول subscription_requests حقيقي (RLS: المستأجر يرى/يُنشئ
--  طلبات مستأجره فقط، super_admin يرى الكل)، + RPCين ذرّيين للاعتماد/الرفض
--  يقفلان الصف (FOR UPDATE) ويتحققان أن status ما زال 'pending' قبل أي
--  تغيير -- هذا تحديداً ما يمنع الاعتماد المزدوج من جهازين مختلفين.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.subscription_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tenant_name       text,
  tenant_email      text,
  plan_id           text NOT NULL,
  plan_name         text,
  amount            numeric NOT NULL DEFAULT 0,
  payment_method    text NOT NULL,
  proof_url         text,
  reference_no      text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes             text,
  rejection_reason  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_requests_tenant ON public.subscription_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscription_requests_status ON public.subscription_requests(status);

ALTER TABLE public.subscription_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_requests_tenant_read ON public.subscription_requests;
CREATE POLICY subscription_requests_tenant_read ON public.subscription_requests
  FOR SELECT TO authenticated
  USING (app_is_super_admin() OR tenant_id = app_current_tenant_id());

DROP POLICY IF EXISTS subscription_requests_tenant_insert ON public.subscription_requests;
CREATE POLICY subscription_requests_tenant_insert ON public.subscription_requests
  FOR INSERT TO authenticated
  WITH CHECK (app_is_super_admin() OR tenant_id = app_current_tenant_id());

-- لا سياسة UPDATE للمستأجر نفسه إطلاقاً -- الاعتماد/الرفض حصراً عبر
-- الدالتين أدناه (SECURITY DEFINER)، فلا مسار عميل مباشر لتغيير status.
DROP POLICY IF EXISTS subscription_requests_super_admin_update ON public.subscription_requests;
CREATE POLICY subscription_requests_super_admin_update ON public.subscription_requests
  FOR UPDATE TO authenticated
  USING (app_is_super_admin())
  WITH CHECK (app_is_super_admin());

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
      v_req.payment_method,
      now(),
      'سداد وتفعيل اشتراك الباقة الأساسية (معتمد من السوبر أدمن)',
      COALESCE(v_req.reference_no, 'APPROVED-' || to_char(now(), 'YYYYMMDDHH24MISS'))
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_subscription_request(
  p_request_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT app_is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM public.subscription_requests WHERE id = p_request_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'subscription request not found' USING ERRCODE = '02000';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'already_processed: request is already %', v_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.subscription_requests
     SET status = 'rejected', rejection_reason = p_reason, updated_at = now()
   WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_subscription_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_subscription_request(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_subscription_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_subscription_request(uuid, text) TO authenticated, service_role;
