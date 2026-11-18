-- seen-status-fix-regressions-task.md item 8: CreditNotes.tsx issued a
-- credit note via a direct `supabase.from('sales_returns').insert(...)`.
-- This table has no role-scoped write policy at all (the generic
-- tenant_tables_loop policy only checks tenant_id), so any staff member
-- -- a cashier included -- could insert an arbitrary refund row directly,
-- with no idempotency (a retried submit after a dropped response creates
-- a second, duplicate credit note -- there is no operation_id/
-- stock_operations guard on this path at all, unlike every other money
-- RPC in this codebase).
--
-- CreditNotes.tsx is NOT process_sales_return's item/quantity-based flow
-- -- process_sales_return's own migration (20261115010000) explicitly
-- notes "unifying this flow with the separate CreditNotes.tsx screen...
-- a product decision, not touched here": CreditNotes.tsx issues a
-- free-form amount against an invoice (a goodwill/financial adjustment,
-- not necessarily a physical stock return), with no order_item_id/
-- quantity in its UI at all. Forcing it through process_sales_return's
-- signature would be a real UX redesign the founder hasn't asked for, so
-- this is a NEW, narrower RPC matching CreditNotes.tsx's actual existing
-- shape instead -- same security properties (role check, idempotency) as
-- every other money-writing RPC in this codebase, not a feature change.
--
-- trg_check_sales_return_total (20260908020000) already bounds the
-- inserted total against the invoice's own total_amount server-side
-- regardless of caller -- kept as the real backstop; this RPC adds the
-- role check and idempotency that table alone cannot provide.

CREATE OR REPLACE FUNCTION public.issue_credit_note(
  p_operation_id   UUID,
  p_invoice_id     UUID,
  p_amount         NUMERIC,
  p_reason         TEXT DEFAULT NULL,
  p_refund_method  payment_method DEFAULT 'cash'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant         uuid;
  v_staff          uuid;
  v_staff_name     text;
  v_role           text;
  v_op_key         text;
  v_existing       jsonb;
  v_return_id      uuid := p_operation_id;
  v_return_number  text;
  v_invoice        RECORD;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار الإشعار الدائن' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'قيمة الإشعار الدائن يجب أن تكون أكبر من صفر' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_current_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إصدار إشعار دائن' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'issue_credit_note:' || p_operation_id::text;
  SELECT result INTO v_existing FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;

  SELECT * INTO v_invoice FROM public.tax_invoices
   WHERE id = p_invoice_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT 'RET-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(v_return_id::text, 1, 8) INTO v_return_number;

  -- trg_check_sales_return_total fires on this INSERT and raises (23514)
  -- if p_amount, added to every prior credit note against this invoice,
  -- would exceed total_amount -- the real cap, enforced regardless of
  -- caller.
  INSERT INTO public.sales_returns (
    id, tenant_id, invoice_id, order_id, return_number, status, reason,
    total_amount, refunded_amount, refund_method, processed_by, returned_at, created_at
  ) VALUES (
    v_return_id, v_tenant, p_invoice_id, v_invoice.order_id, v_return_number, 'completed',
    NULLIF(p_reason, ''), p_amount, p_amount, p_refund_method, v_staff, now(), now()
  );

  INSERT INTO public.employee_activity_logs (
    tenant_id, staff_id, staff_name, action, details, occurred_at
  ) VALUES (
    v_tenant, v_staff, COALESCE(v_staff_name, 'System'), 'create_credit_note',
    'إصدار إشعار دائن رقم ' || v_return_number || ' للفاتورة ' || COALESCE(v_invoice.invoice_number, p_invoice_id::text), now()
  );

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'issue_credit_note',
          jsonb_build_object('return_id', v_return_id, 'return_number', v_return_number, 'refunded_amount', p_amount));

  RETURN jsonb_build_object('return_id', v_return_id, 'return_number', v_return_number,
                             'refunded_amount', p_amount, 'replayed', false);
END $$;

REVOKE EXECUTE ON FUNCTION public.issue_credit_note(UUID, UUID, NUMERIC, TEXT, payment_method) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.issue_credit_note(UUID, UUID, NUMERIC, TEXT, payment_method) TO authenticated;

-- CreditNotes.tsx's direct write is replaced (same commit) by this RPC --
-- close the generic tenant-match INSERT policy on sales_returns now that
-- no legitimate client path needs it (process_sales_return and this RPC
-- are both SECURITY DEFINER and bypass RLS entirely).
DROP POLICY IF EXISTS "sales_returns_tenant_insert" ON public.sales_returns;
