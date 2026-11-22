-- seen-readiness-fixes-task.md P4 (OPERATIONS-07, OPERATIONS-14,
-- OPERATIONS-08).
--
--  * An order that has money on it, cloth cut for it or a tax invoice is not
--    deleted (payments.order_id was set to NULL -- orphan money -- and cut
--    cloth simply vanished). It is cancelled instead (cancel_order, P1.4).
--  * A customer with open orders or money still owed is not deleted
--    (orders.customer_id was set to NULL, the debt lost its customer).
--  * A tax invoice's paid amount follows its order's, in the same
--    transaction, whichever screen took the payment (the customer statement
--    never updated it). The browser no longer sends it.
-- Deleting a whole shop (by the platform, as postgres/service_role) is not
-- affected.
-- Rollback: supabase/rollbacks/20270105_order_customer_guards.down.sql

CREATE OR REPLACE FUNCTION public.guard_order_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN OLD;
  END IF;
  IF COALESCE(OLD.paid_amount, 0) > 0 OR OLD.fabric_deducted_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.tax_invoices WHERE order_id = OLD.id) THEN
    RAISE EXCEPTION 'لا يُحذف طلب عليه دفعات أو قُصّ قماشه أو صدرت له فاتورة — ألغِه بدلاً من الحذف'
      USING ERRCODE = '22023';
  END IF;
  RETURN OLD;
END;
$function$;
DROP TRIGGER IF EXISTS orders_guard_delete ON public.orders;
CREATE TRIGGER orders_guard_delete BEFORE DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_order_delete();

CREATE OR REPLACE FUNCTION public.guard_customer_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.customer_id = OLD.id AND o.status <> 'cancelled'
       AND (o.status <> 'delivered' OR round(COALESCE(o.total_amount, 0) - COALESCE(o.paid_amount, 0), 2) > 0)) THEN
    RAISE EXCEPTION 'لا يُحذف عميل له طلبات مفتوحة أو مبلغ متبقٍ' USING ERRCODE = '22023';
  END IF;
  RETURN OLD;
END;
$function$;
DROP TRIGGER IF EXISTS customers_guard_delete ON public.customers;
CREATE TRIGGER customers_guard_delete BEFORE DELETE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.guard_customer_delete();

CREATE OR REPLACE FUNCTION public.sync_invoice_paid_from_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.tax_invoices SET paid_amount = NEW.paid_amount
   WHERE order_id = NEW.id AND paid_amount IS DISTINCT FROM NEW.paid_amount;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_invoice_paid_from_order() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orders_sync_invoice_paid ON public.orders;
CREATE TRIGGER orders_sync_invoice_paid AFTER UPDATE OF paid_amount ON public.orders
FOR EACH ROW WHEN (NEW.paid_amount IS DISTINCT FROM OLD.paid_amount)
EXECUTE FUNCTION public.sync_invoice_paid_from_order();
