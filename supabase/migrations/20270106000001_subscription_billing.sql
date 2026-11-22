-- seen-readiness-fixes-task.md P5 (PLATFORM-05, PLATFORM-06; founder
-- question 7, default) -- Seen's subscription billing, apart from the shop's
-- sales, for the real period of each plan.
--
-- Before: approving a subscription added a year whatever the plan, recorded
-- the payment only for the 'basic' plan -- and into public.payments, the
-- shop's own sales payments -- while the billing page listed every row of
-- public.payments (all the shop's sales) as "subscription invoices".
--
-- Now:
--  * plans.billing_period (month | year); approval adds that period from the
--    later of today and the current end date;
--  * saas_subscription_payments: one row per approved request, every plan,
--    with a receipt number (SUB-000001...) and the period it pays for. The
--    shop reads its own rows; the billing page lists only these, each with a
--    receipt that says it is not a tax invoice (Seen is not VAT-registered);
--  * earlier subscription payments recorded in public.payments are copied
--    into the new ledger. They are NOT removed from public.payments -- that
--    is for the founder to decide.
-- Rollback: supabase/rollbacks/20270106_subscription_billing.down.sql

ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS billing_period text NOT NULL DEFAULT 'year'
  CHECK (billing_period IN ('month', 'year'));

CREATE SEQUENCE IF NOT EXISTS public.saas_subscription_receipt_seq;

CREATE TABLE IF NOT EXISTS public.saas_subscription_payments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  request_id      uuid        UNIQUE,
  plan_id         text,
  plan_name       text,
  amount          numeric     NOT NULL DEFAULT 0,
  original_amount numeric,
  discount_amount numeric,
  payment_method  text,
  reference       text,
  period_start    timestamptz,
  period_end      timestamptz,
  receipt_number  text        NOT NULL UNIQUE DEFAULT ('SUB-' || lpad(nextval('public.saas_subscription_receipt_seq')::text, 6, '0')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saas_subscription_payments_tenant ON public.saas_subscription_payments (tenant_id, created_at DESC);
ALTER TABLE public.saas_subscription_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saas_subscription_payments_read ON public.saas_subscription_payments;
CREATE POLICY saas_subscription_payments_read ON public.saas_subscription_payments FOR SELECT TO authenticated
  USING (app_is_super_admin() OR (tenant_id = app_current_tenant_id()
         AND (app_has_permission('settings.billing'::text) OR app_has_permission('settings.view'::text))));
REVOKE INSERT, UPDATE, DELETE ON public.saas_subscription_payments FROM anon, authenticated;

-- What was approved before: one ledger row per approved request.
INSERT INTO public.saas_subscription_payments (tenant_id, request_id, plan_id, plan_name, amount, original_amount, discount_amount, payment_method, reference, created_at)
SELECT r.tenant_id, r.id, r.plan_id, r.plan_name, COALESCE(r.amount, 0), r.original_amount, r.discount_amount, r.payment_method, r.reference_no, r.updated_at
  FROM public.subscription_requests r
 WHERE r.status = 'approved' AND r.tenant_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = r.tenant_id)
 ORDER BY r.updated_at
ON CONFLICT (request_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.approve_subscription_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req    record;
  v_period text;
  v_start  timestamptz;
  v_end    timestamptz;
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

  -- seen-readiness-fixes-task.md P5 (PLATFORM-06): the plan's own period
  -- (was a year for every plan), from the later of today and the current end.
  SELECT COALESCE(billing_period, 'year') INTO v_period FROM public.plans WHERE id = v_req.plan_id;
  SELECT GREATEST(now(), COALESCE(subscription_end_date, now())) INTO v_start FROM public.tenants WHERE id = v_req.tenant_id;
  v_end := v_start + CASE WHEN v_period = 'month' THEN interval '1 month' ELSE interval '1 year' END;

  UPDATE public.tenants
     SET plan_id = v_req.plan_id,
         status = 'active',
         subscription_status = 'active',
         is_trial = false,
         locked_at = NULL,
         purge_at = NULL,
         subscription_end_date = v_end,
         updated_at = now()
   WHERE id = v_req.tenant_id;

  -- P5 (PLATFORM-05, PLATFORM-06, question 7): Seen's own payment, for every
  -- plan, in Seen's own ledger with a receipt number -- not in the shop's
  -- payments (its sales), which the billing page used to show as Seen's.
  INSERT INTO public.saas_subscription_payments (
    tenant_id, request_id, plan_id, plan_name, amount, original_amount, discount_amount,
    payment_method, reference, period_start, period_end)
  VALUES (
    v_req.tenant_id, v_req.id, v_req.plan_id, v_req.plan_name, COALESCE(v_req.amount, 0),
    v_req.original_amount, v_req.discount_amount, v_req.payment_method,
    COALESCE(v_req.reference_no, 'APPROVED-' || to_char(now(), 'YYYYMMDDHH24MISS')), v_start, v_end)
  ON CONFLICT (request_id) DO NOTHING;
END;
$function$
;
