-- Rollback of 20270105000002_order_customer_guards.sql.
DROP TRIGGER IF EXISTS orders_guard_delete ON public.orders;
DROP TRIGGER IF EXISTS customers_guard_delete ON public.customers;
DROP TRIGGER IF EXISTS orders_sync_invoice_paid ON public.orders;
DROP FUNCTION IF EXISTS public.guard_order_delete();
DROP FUNCTION IF EXISTS public.guard_customer_delete();
DROP FUNCTION IF EXISTS public.sync_invoice_paid_from_order();
