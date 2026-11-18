-- status-review-2026-11-17/C-sprint2-4.md finding A1 (High): 20261122000000
-- narrowed orders UPDATE to owner/admin/manager only. That migration's own
-- grep (comment in 20261122000000, lines 24-35) found and fixed the two
-- POS.tsx payment call sites but missed two more real, live call sites:
--   - Orders.tsx updateStatus() and confirmDelivery() -- every order status
--     change (measurements -> cutting -> ... -> delivered) goes through a
--     direct `supabase.from('orders').update({status, status_key, ...})`.
--     The /orders route is allowed for cashier and tailor
--     (App.tsx:850/969), and updateStatus() itself has no role check --
--     changing an order's status is core, everyday tailor/cashier work.
--   - Customers.tsx handlePaymentSubmit() -- writes `orders.paid_amount`
--     directly (the same bug record_order_payment was built to fix
--     elsewhere; this call site was simply never migrated).
--
-- After 20261122000000, both paths still "succeed" from the UI's point of
-- view: PostgREST returns 200 with an empty array for an UPDATE whose
-- WHERE/RLS check matches zero rows, so `if (error) throw error` never
-- fires, the UI optimistically updates local state and toasts success, and
-- nothing is actually written. A tailor moving an order to "جاهز للاستلام"
-- or a cashier taking a customer's remaining balance both silently no-op.
--
-- Fix, same shape as record_order_payment (20261115040000): one
-- SECURITY DEFINER RPC per concern, instead of re-opening direct UPDATE on
-- `orders` to the wider role set (which would also re-open paid_amount/
-- total_amount to direct tampering -- exactly what 20261122000000 closed).
--
-- 1. update_order_status(p_order_id, p_status, p_status_key, p_notes):
--    owner/admin/manager/cashier/tailor (the exact roles the /orders route
--    already allows) may change status/status_key/notes. Business rules
--    enforced here, not just in the UI, since this now runs with RLS
--    bypassed: a delivered order is locked, and an order cannot be marked
--    delivered while a balance remains -- both already enforced
--    client-side in Orders.tsx, now also enforced server-side.
-- 2. Customers.tsx handlePaymentSubmit is fixed in the same commit as this
--    migration to call the existing record_order_payment RPC (no DB change
--    needed for that -- record_order_payment already checks tenant only,
--    same as the POS.tsx/Orders.tsx call sites already using it).

CREATE OR REPLACE FUNCTION public.update_order_status(
  p_order_id    UUID,
  p_status      TEXT,
  p_status_key  TEXT,
  p_notes       TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant     uuid;
  v_role       text;
  v_total      numeric;
  v_paid       numeric;
  v_status     order_status;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_current_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager', 'cashier', 'tailor') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل حالة الطلب' USING ERRCODE = '42501';
  END IF;

  SELECT total_amount, paid_amount, status INTO v_total, v_paid, v_status
    FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_status = 'delivered' THEN
    RAISE EXCEPTION 'لا يمكن تعديل طلب تم تسليمه' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'delivered' AND round(v_total - v_paid, 2) > 0 THEN
    RAISE EXCEPTION 'لا يمكن تسليم طلب عليه مبلغ متبقٍ' USING ERRCODE = '23514';
  END IF;

  UPDATE public.orders SET
    status      = p_status::order_status,
    status_key  = p_status_key,
    notes       = COALESCE(p_notes, notes),
    updated_at  = now()
  WHERE id = p_order_id;

  RETURN jsonb_build_object('order_id', p_order_id, 'status', p_status, 'status_key', p_status_key);
END $$;

REVOKE EXECUTE ON FUNCTION public.update_order_status(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_order_status(UUID, TEXT, TEXT, TEXT) TO authenticated;
