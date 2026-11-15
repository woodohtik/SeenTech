-- seen-cto-code-review-2026-11-13.md, سبرنت 1، البند 5 (C9، الجزء المتبقي
-- بعد الإصلاح العاجل في سبرنت 0 لفحص {error} وقراءة notes).
--
-- Both payment-recording call sites in Orders.tsx (handleQuickPayment and
-- PaymentModal's handlePayment) call `supabase.from('orders').update({
-- paid_amount, history: ..., items: ... })`. Neither `history` nor
-- `items` is a real column on `orders` -- order history lives in the
-- separate `order_history` table, and order line items live in
-- `order_items`. The write does not fail outright: a client-only fetch
-- interceptor (src/services/supabase/client.ts) catches every PATCH to
-- /rest/v1/orders, strips `history`/`items`, and packs them into the
-- `notes` column as a JSON blob (`__ORDER_METADATA_V2__:...`), decoding
-- them back out on every read the same way. This "payment history"
-- therefore only exists as a blob stuffed inside the free-text notes
-- field, invisible to any caller that is not this exact JS client --
-- including this migration's own SQL and any report run directly
-- against the database -- and is not a real audit trail. Before the
-- sprint-0 fix added the `{error}` check, a failure anywhere in this
-- path (e.g. the interceptor's own merge-fetch) was swallowed and the
-- UI updated local state as if the payment had gone through, which is
-- the "payment lost, screen says paid" scenario this finding describes.
--
-- Also still true even with a correct column list: the read-then-update
-- (SELECT paid_amount, then UPDATE) has no row lock, so two payments
-- submitted close together (two staff, or a retry) can both read the
-- same stale paid_amount and the second write clobbers the first's
-- contribution. And paid tailoring/custom orders have no payments-table
-- row at all and are not linked to any shift, so this cash never enters
-- a till's reconciliation.
--
-- Fix: record_order_payment(p_operation_id, p_order_id, p_amount,
-- p_method, p_shift_id, p_notes, p_complete_status, p_complete_status_key)
-- -- one atomic, idempotent RPC:
-- - `FOR UPDATE` on the order row closes the race between two concurrent
--   payments.
-- - Caps p_amount at the live remaining amount (total_amount -
--   paid_amount), computed inside the same lock.
-- - Writes a real `payments` row (this table already exists, already
--   has shift_id/order_id/invoice_id columns, and already backs
--   subscription payments elsewhere -- it was simply never written to
--   for order payments) and a real `order_history` row, instead of the
--   two nonexistent `orders` columns.
-- - p_shift_id is optional (Orders.tsx has no shift-context plumbing
--   today, unlike POS.tsx/SalesReturns.tsx -- see the "محجوز" note in
--   the task file): when given, it must be a real open shift in this
--   tenant, so a payment can be attributed to the till that actually
--   collected it whenever that context exists; when omitted, the
--   payment still gets a durable `payments` row, same as before.
-- - If p_complete_status is given and the payment brings the order to
--   remaining = 0, the status transition is applied in the SAME
--   transaction as the payment (matches the sprint-0 fix's own reasoning
--   for combining these into one atomic write, now done correctly).

CREATE OR REPLACE FUNCTION public.record_order_payment(
  p_operation_id         UUID,
  p_order_id             UUID,
  p_amount               NUMERIC,
  p_method               payment_method,
  p_shift_id             UUID DEFAULT NULL,
  p_notes                TEXT DEFAULT NULL,
  p_complete_status      TEXT DEFAULT NULL,
  p_complete_status_key  TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant          uuid;
  v_staff           uuid;
  v_staff_name      text;
  v_op_key          text;
  v_existing        jsonb;

  v_total           numeric;
  v_paid            numeric;
  v_status          order_status;
  v_remaining       numeric;
  v_new_paid        numeric;
  v_new_remaining   numeric;
  v_invoice_id      uuid;
  v_completed       boolean := false;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار الدفعة' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'قيمة الدفعة يجب أن تكون أكبر من صفر' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'record_order_payment:' || p_operation_id::text;
  SELECT result INTO v_existing FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;

  IF p_shift_id IS NOT NULL THEN
    PERFORM 1 FROM public.shifts
     WHERE id = p_shift_id AND tenant_id = v_tenant AND status = 'open';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الوردية المحددة غير مفتوحة أو غير صحيحة' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT total_amount, paid_amount, status INTO v_total, v_paid, v_status
    FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_remaining := round(v_total - v_paid, 2);
  IF p_amount > v_remaining THEN
    RAISE EXCEPTION 'المبلغ أكبر من المتبقي على الطلب (المتبقي %)', v_remaining USING ERRCODE = '23514';
  END IF;

  v_new_paid := round(v_paid + p_amount, 2);
  v_new_remaining := round(v_total - v_new_paid, 2);
  v_completed := v_new_remaining = 0 AND p_complete_status IS NOT NULL;

  IF v_completed THEN
    UPDATE public.orders SET
      paid_amount = v_new_paid,
      payment_method = p_method,
      status = p_complete_status::order_status,
      status_key = p_complete_status_key,
      updated_at = now()
    WHERE id = p_order_id;
  ELSE
    UPDATE public.orders SET
      paid_amount = v_new_paid,
      payment_method = p_method,
      updated_at = now()
    WHERE id = p_order_id;
  END IF;

  SELECT id INTO v_invoice_id FROM public.tax_invoices WHERE order_id = p_order_id ORDER BY issued_at DESC LIMIT 1;

  INSERT INTO public.payments (tenant_id, order_id, invoice_id, shift_id, amount, method, received_by, notes)
  VALUES (v_tenant, p_order_id, v_invoice_id, p_shift_id, p_amount, p_method, v_staff, p_notes);

  INSERT INTO public.order_history (tenant_id, order_id, status, notes, updated_by_staff, updated_by_name)
  VALUES (
    v_tenant, p_order_id,
    CASE WHEN v_completed THEN p_complete_status::order_status ELSE v_status END,
    p_notes, v_staff, COALESCE(v_staff_name, 'Staff')
  );

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'record_order_payment', jsonb_build_object(
    'order_id', p_order_id, 'paid_amount', v_new_paid, 'remaining_amount', v_new_remaining, 'completed', v_completed
  ));

  RETURN jsonb_build_object(
    'order_id', p_order_id, 'paid_amount', v_new_paid, 'remaining_amount', v_new_remaining,
    'completed', v_completed, 'replayed', false
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.record_order_payment(UUID, UUID, NUMERIC, payment_method, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_order_payment(UUID, UUID, NUMERIC, payment_method, UUID, TEXT, TEXT, TEXT) TO authenticated;
