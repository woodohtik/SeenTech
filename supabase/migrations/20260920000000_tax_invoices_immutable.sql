-- Closes a critical finding from the 2026-09-17 full-team review
-- (compliance-reviewer): tax_invoices had no protection at all against
-- UPDATE/DELETE after issuance -- it wasn't included in
-- wdooh-database-schema.sql's list of audit-style tables that get their
-- update/delete policies dropped (stock_ledger, audit_logs, security_logs,
-- employee_activity_logs, order_history all are). Any active staff member
-- could tamper with or delete an issued tax invoice directly via
-- Postgrest, with nothing at the database layer to stop them -- a real
-- gap against the record-integrity requirements ZATCA and general
-- accounting practice both expect from an issued tax invoice.
--
-- A BEFORE UPDATE/DELETE trigger (not a dropped RLS policy) so the error
-- message is clear and specific, matching the existing pattern in
-- 20260822090400_tenants_owner_update_and_plan_guard.sql's
-- tenants_block_client_plan_edit_trigger.
--
-- Verified there is currently no legitimate UPDATE path to tax_invoices
-- anywhere in the codebase (grepped src/, server.ts, all migrations), and
-- exactly one DELETE path: trialService.ts's deleteTestDataForTenant(),
-- which only ever deletes invoices linked to an order with is_test=true.
-- That one case is allowed through; everything else (real invoices, from
-- any non-service-role session) is blocked outright.
--
-- Deliberately NOT SECURITY DEFINER: current_user inside a SECURITY
-- DEFINER function body reflects the function's OWNER, not the actual
-- caller -- verified live via a temporary migration that this made the
-- `current_user IN ('postgres', 'service_role')` check always true
-- regardless of who actually issued the UPDATE, silently defeating the
-- whole guard. Plain SECURITY INVOKER (the default) makes current_user
-- correctly reflect whatever role PostgREST SET ROLE'd to for the
-- request (anon/authenticated/service_role). The orders.is_test lookup
-- below doesn't need elevated privileges either: RLS already lets any
-- authenticated staff read orders within their own tenant.
CREATE OR REPLACE FUNCTION public.prevent_tax_invoice_tamper()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_is_test boolean;
BEGIN
  IF app_is_super_admin() OR current_user IN ('postgres', 'service_role') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT is_test INTO v_is_test FROM public.orders WHERE id = OLD.order_id;
  IF COALESCE(v_is_test, false) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'الفواتير الضريبية الصادرة سجل ثابت -- لا يمكن تعديلها أو حذفها مباشرة بعد الإصدار'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_tax_invoices_immutable ON public.tax_invoices;
CREATE TRIGGER trg_tax_invoices_immutable
BEFORE UPDATE OR DELETE ON public.tax_invoices
FOR EACH ROW EXECUTE FUNCTION public.prevent_tax_invoice_tamper();
