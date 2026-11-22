-- seen-readiness-fixes-task.md P2.4 (ZATCA-01, ZATCA-17, PLATFORM-11,
-- RELIABILITY-03) -- ZATCA is sent from the server, through a queue.
--
-- Before: only the cashier's browser sent an invoice, right after a POS sale.
-- A tailoring order's invoice, a sale synced from offline and a failed send
-- were never sent again, and a network error was recorded as "rejected".
--
-- Now every tax invoice and every credit note is queued the moment it exists
-- (triggers on tax_invoices / sales_returns -- whatever path created it: the
-- POS, issue_tax_invoice_for_order, an offline replay, issue_credit_note,
-- cancel_order). The server's worker (/api/cron/zatca-queue, scheduled by
-- .github/workflows/zatca-queue.yml) sends what is due and retries with a
-- growing delay; ZATCA's own rejection is kept with its reason for the owner.
-- The cashier's device still asks for an immediate send; the worker then sees
-- the document already reported and just closes the row.
-- Rollback: supabase/rollbacks/20270103_zatca_submission_queue.down.sql

CREATE TABLE IF NOT EXISTS public.zatca_submissions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind            text        NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
  -- invoice: the order id (the send route's key); credit_note: the sales_returns id
  ref_id          uuid        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sending', 'retry', 'sent', 'rejected', 'failed', 'not_applicable')),
  attempts        int         NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  last_result     jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_zatca_submissions_due ON public.zatca_submissions (next_attempt_at)
  WHERE status IN ('pending', 'retry', 'sending');
CREATE INDEX IF NOT EXISTS idx_zatca_submissions_tenant ON public.zatca_submissions (tenant_id, created_at DESC);

ALTER TABLE public.zatca_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zatca_submissions_read ON public.zatca_submissions;
-- The owner's screen: who manages tax settings or views invoices in this shop.
CREATE POLICY zatca_submissions_read ON public.zatca_submissions FOR SELECT TO authenticated
  USING (app_is_super_admin() OR (tenant_id = app_current_tenant_id()
         AND (app_has_permission('settings.tax'::text) OR app_has_permission('invoices.view'::text))));
REVOKE INSERT, UPDATE, DELETE ON public.zatca_submissions FROM anon, authenticated;

-- Queue every new invoice and credit note ------------------------------------
CREATE OR REPLACE FUNCTION public.zatca_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'tax_invoices' THEN
    INSERT INTO public.zatca_submissions (tenant_id, kind, ref_id)
    VALUES (NEW.tenant_id, 'invoice', NEW.order_id) ON CONFLICT (kind, ref_id) DO NOTHING;
  ELSIF NEW.invoice_id IS NOT NULL THEN
    INSERT INTO public.zatca_submissions (tenant_id, kind, ref_id)
    VALUES (NEW.tenant_id, 'credit_note', NEW.id) ON CONFLICT (kind, ref_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.zatca_enqueue() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tax_invoices_zatca_enqueue ON public.tax_invoices;
CREATE TRIGGER tax_invoices_zatca_enqueue AFTER INSERT ON public.tax_invoices
FOR EACH ROW WHEN (NEW.order_id IS NOT NULL) EXECUTE FUNCTION public.zatca_enqueue();
DROP TRIGGER IF EXISTS sales_returns_zatca_enqueue ON public.sales_returns;
CREATE TRIGGER sales_returns_zatca_enqueue AFTER INSERT ON public.sales_returns
FOR EACH ROW EXECUTE FUNCTION public.zatca_enqueue();

-- Documents of the last 24 hours not yet accepted (a simplified invoice is due within 24 hours).
INSERT INTO public.zatca_submissions (tenant_id, kind, ref_id)
SELECT i.tenant_id, 'invoice', i.order_id FROM public.tax_invoices i
 WHERE i.order_id IS NOT NULL AND i.created_at > now() - interval '24 hours'
   AND coalesce(i.zatca_status, '') NOT IN ('cleared', 'reported')
ON CONFLICT (kind, ref_id) DO NOTHING;
INSERT INTO public.zatca_submissions (tenant_id, kind, ref_id)
SELECT r.tenant_id, 'credit_note', r.id FROM public.sales_returns r
 WHERE r.invoice_id IS NOT NULL AND r.created_at > now() - interval '24 hours'
   AND coalesce(r.zatca_status, '') NOT IN ('cleared', 'reported')
ON CONFLICT (kind, ref_id) DO NOTHING;

-- The worker's two calls (server only) ----------------------------------------
-- Take up to p_limit due rows; a row left "sending" for 15 minutes (a crashed
-- worker) is due again.
CREATE OR REPLACE FUNCTION public.zatca_claim_submissions(p_limit int DEFAULT 20)
RETURNS SETOF public.zatca_submissions
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.zatca_submissions s
     SET status = 'sending', attempts = s.attempts + 1, updated_at = now()
   WHERE s.id IN (
     SELECT id FROM public.zatca_submissions
      WHERE (status IN ('pending', 'retry') AND next_attempt_at <= now())
         OR (status = 'sending' AND updated_at < now() - interval '15 minutes')
      ORDER BY next_attempt_at
      LIMIT GREATEST(p_limit, 1)
      FOR UPDATE SKIP LOCKED)
  RETURNING s.*;
$function$;

-- Record the outcome. 'retry' waits 2^attempts minutes (at most 6 hours) and
-- turns into 'failed' -- shown to the owner -- after 30 attempts.
CREATE OR REPLACE FUNCTION public.zatca_finish_submission(p_id uuid, p_status text, p_error text DEFAULT NULL, p_result jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_attempts int;
BEGIN
  IF p_status NOT IN ('sent', 'rejected', 'failed', 'not_applicable', 'retry') THEN
    RAISE EXCEPTION 'unknown status %', p_status USING ERRCODE = '22023';
  END IF;
  SELECT attempts INTO v_attempts FROM public.zatca_submissions WHERE id = p_id;
  UPDATE public.zatca_submissions SET
    status = CASE WHEN p_status = 'retry' AND v_attempts >= 30 THEN 'failed' ELSE p_status END,
    next_attempt_at = CASE WHEN p_status = 'retry'
                           THEN now() + make_interval(mins => LEAST(power(2, LEAST(v_attempts, 9))::int, 360))
                           ELSE next_attempt_at END,
    last_error = p_error,
    last_result = p_result,
    updated_at = now()
  WHERE id = p_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.zatca_claim_submissions(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zatca_finish_submission(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zatca_claim_submissions(int), public.zatca_finish_submission(uuid, text, text, jsonb) TO service_role;
