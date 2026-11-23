-- Rollback of 20270108000000_cash_movements_and_invoice_paid.sql
DROP FUNCTION IF EXISTS public.record_cash_movement(uuid, uuid, text, numeric, text);
GRANT INSERT, UPDATE, DELETE ON public.shift_entries TO authenticated;
CREATE OR REPLACE FUNCTION public.sync_tax_invoice_paid_amount(p_order_id uuid, p_paid_amount numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    app_is_super_admin()
    OR EXISTS (SELECT 1 FROM orders o WHERE o.id = p_order_id AND o.tenant_id = app_current_tenant_id())
  ) THEN
    RAISE EXCEPTION 'لا يمكنك تعديل فاتورة هذا الطلب' USING ERRCODE = '42501';
  END IF;

  UPDATE tax_invoices SET paid_amount = p_paid_amount, updated_at = now()
  WHERE order_id = p_order_id;
END;
$$;

