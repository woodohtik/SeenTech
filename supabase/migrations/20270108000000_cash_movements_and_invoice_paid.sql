-- seen-readiness-fixes-task.md P6 (MONEY-10, MONEY-11) -- cash in and out of
-- a drawer goes through the server, and a tax invoice's paid amount is the
-- order's, never a number from the browser.
--
--  * record_cash_movement(operation, shift, 'deposit' | 'payout', amount,
--    reason): the shift is open and in the caller's shop, and it is the
--    caller's own shift unless the caller has shifts.manage; a positive
--    amount up to 1,000,000 and a reason; the operation id is the entry id,
--    so a retry returns the same entry instead of a second one.
--  * shift_entries: no INSERT / UPDATE / DELETE from the browser any more
--    (the drawer's history is not edited after the fact). The functions that
--    write it (close_shift's callers, issue_supplier_payment, cancel_order)
--    are SECURITY DEFINER and keep working.
--  * sync_tax_invoice_paid_amount keeps its signature (installed apps call
--    it) but copies orders.paid_amount; the number passed in is ignored.
--    orders_sync_invoice_paid (P4) already keeps them equal on every change.
-- Rollback: supabase/rollbacks/20270108_cash_movements_and_invoice_paid.down.sql

CREATE OR REPLACE FUNCTION public.record_cash_movement(
  p_operation_id uuid, p_shift_id uuid, p_kind text, p_amount numeric, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := app_current_tenant_id();
  v_actor  uuid := app_actor_staff_id();
  v_shift  record;
  v_entry  record;
BEGIN
  IF v_tenant IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'معرّف العملية مطلوب' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_entry FROM public.shift_entries WHERE id = p_operation_id;
  IF v_entry.id IS NOT NULL THEN
    IF v_entry.tenant_id <> v_tenant THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('entry_id', v_entry.id, 'replayed', true);
  END IF;
  IF p_kind NOT IN ('deposit', 'payout') THEN
    RAISE EXCEPTION 'نوع العملية غير صالح' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000 THEN
    RAISE EXCEPTION 'المبلغ غير صالح' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'السبب مطلوب' USING ERRCODE = '22023';
  END IF;

  SELECT id, tenant_id, staff_id, status INTO v_shift FROM public.shifts WHERE id = p_shift_id FOR UPDATE;
  IF v_shift.id IS NULL OR v_shift.tenant_id <> v_tenant THEN
    RAISE EXCEPTION 'الوردية غير موجودة' USING ERRCODE = '42501';
  END IF;
  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'الوردية مغلقة: لا إيداع ولا سحب عليها' USING ERRCODE = '22023';
  END IF;
  IF v_shift.staff_id IS DISTINCT FROM v_actor AND NOT app_has_permission('shifts.manage') THEN
    RAISE EXCEPTION 'لا تملك صلاحية الإيداع أو السحب في وردية موظف آخر' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.shift_entries (id, tenant_id, shift_id, entry_type, amount, reason, occurred_at, created_by, created_at)
  VALUES (p_operation_id, v_tenant, p_shift_id, p_kind::public.shift_entry_type, round(p_amount, 2), btrim(p_reason), now(), v_actor, now());
  RETURN jsonb_build_object('entry_id', p_operation_id, 'replayed', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_cash_movement(uuid, uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_cash_movement(uuid, uuid, text, numeric, text) TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.shift_entries FROM anon, authenticated;

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

  -- P6 (MONEY-10): the order's own paid amount; p_paid_amount is ignored.
  UPDATE tax_invoices ti SET paid_amount = o.paid_amount, updated_at = now()
    FROM orders o
   WHERE o.id = p_order_id AND ti.order_id = o.id AND ti.paid_amount IS DISTINCT FROM o.paid_amount;
END;
$$;
