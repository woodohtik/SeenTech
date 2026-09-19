-- Hotfix for 20260920000000_tax_invoices_immutable.sql.
--
-- That migration's trigger function was SECURITY DEFINER. Inside a
-- SECURITY DEFINER function body, current_user reflects the function's
-- OWNER, not the actual caller -- confirmed live via a temporary
-- read-only migration (SET LOCAL ROLE authenticated inside a superuser
-- session, then a real UPDATE against a genuine, non-test invoice
-- succeeded when it should have been blocked). That meant
-- `current_user IN ('postgres', 'service_role')` was always true no
-- matter who actually issued the UPDATE/DELETE, so the guard never
-- actually blocked anything in practice -- a false sense of protection
-- that would have been worse than no trigger at all if it had shipped
-- unnoticed. Caught before being reported as done.
--
-- Fixed by dropping SECURITY DEFINER (plain SECURITY INVOKER, the
-- default): current_user then correctly reflects whatever role
-- PostgREST SET ROLE'd to for the request. The orders.is_test lookup
-- doesn't need elevated privileges -- RLS already lets any authenticated
-- staff read orders within their own tenant.
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
