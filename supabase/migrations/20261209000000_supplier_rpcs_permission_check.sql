-- docs/superpowers/plans/2026-11-18-permissions-server-enforcement.md Task 5.
--
-- issue_supplier_payment's and increment_supplier_balance's role checks
-- today are hard-coded role-name lists
-- (owner/admin/manager/accountant for issue_supplier_payment,
-- owner/admin/manager/accountant for increment_supplier_balance) that
-- ignore roles.permissions (tenant-custom roles) and
-- user_permission_overrides entirely, same gap Tasks 2-4 closed on
-- create_pos_sale, close_shift and approve_stock_take. Replaces both with
-- app_has_permission('suppliers.manage') (Task 1).
--
-- This is a deliberate, founder-approved behavior CHANGE, not a mechanical
-- port: per Task 1's default-permission matrix, both branch_manager AND
-- warehouse_manager have suppliers.manage = true, so this swap widens real
-- server-side access to both roles -- neither was in the old enum list.
-- The UI already showed supplier-payment controls to these roles; the
-- server was the one lagging. This closes that UI/server gap.
--
-- Both function bodies are otherwise byte-for-byte identical to their
-- current definitions in supabase/migrations/20261115060000_issue_supplier_payment_atomic.sql
-- and supabase/migrations/20261121000000_supplier_balance_role_guard.sql.

CREATE OR REPLACE FUNCTION public.issue_supplier_payment(
  p_operation_id   UUID,
  p_supplier_id    UUID,
  p_amount         NUMERIC,
  p_method         TEXT,
  p_shift_id       UUID DEFAULT NULL,
  p_voucher_date   DATE DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant       uuid;
  v_staff        uuid;
  v_role         text;
  v_op_key       text;
  v_existing     jsonb;

  v_balance      numeric;
  v_new_balance  numeric;
  v_voucher_num  bigint;
  v_voucher_no   text;
  v_tx_id        uuid;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار سند الصرف' USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'قيمة السند يجب أن تكون أكبر من صفر' USING ERRCODE = '22023';
  END IF;

  IF p_method NOT IN ('cash', 'bank_transfer') THEN
    RAISE EXCEPTION 'طريقة دفع غير صالحة لسند الصرف' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'issue_supplier_payment:' || p_operation_id::text;
  SELECT result INTO v_existing FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_staff := public.app_current_staff_id();
  v_role := public.app_current_role();

  -- SUP-15: nothing below the /suppliers route gate checked who may pay
  -- a supplier out of the drawer. Owner/admin/manager (operational
  -- authority) and accountant (the role this operation exists for).
  IF NOT public.app_has_permission('suppliers.manage') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إصدار سند صرف للمورد' USING ERRCODE = '42501';
  END IF;

  IF p_shift_id IS NOT NULL THEN
    PERFORM 1 FROM public.shifts
     WHERE id = p_shift_id AND tenant_id = v_tenant AND status = 'open';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الوردية المحددة غير مفتوحة أو غير صحيحة' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT balance INTO v_balance FROM public.suppliers
   WHERE id = p_supplier_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_new_balance := round(COALESCE(v_balance, 0) - p_amount, 2);

  v_voucher_num := public.allocate_tenant_voucher_number(v_tenant);
  v_voucher_no := 'PV-' || lpad(v_voucher_num::text, 6, '0');

  UPDATE public.suppliers SET balance = v_new_balance, updated_at = now()
   WHERE id = p_supplier_id;

  v_tx_id := gen_random_uuid();
  INSERT INTO public.supplier_transactions (
    id, tenant_id, supplier_id, type, credit, debit, running_balance,
    reference_number, date, notes, created_by
  ) VALUES (
    v_tx_id, v_tenant, p_supplier_id, 'payment', 0, p_amount, v_new_balance,
    v_voucher_no, COALESCE(p_voucher_date::timestamptz, now()), p_notes, v_staff
  );

  -- CASH-18: the cash-drawer leg used to be a third, separate,
  -- best-effort write (its own try/catch that only logged to the
  -- console) made AFTER the ledger write -- now part of the same
  -- transaction as the debit itself, so a cash voucher can never exist
  -- without its shift_entries payout row, or vice versa.
  IF p_method = 'cash' AND p_shift_id IS NOT NULL THEN
    INSERT INTO public.shift_entries (tenant_id, shift_id, entry_type, amount, reason, created_by)
    VALUES (v_tenant, p_shift_id, 'payout', p_amount,
            'سند صرف رقم ' || v_voucher_no || ' للمورد', v_staff);
  END IF;

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'issue_supplier_payment', jsonb_build_object(
    'transaction_id', v_tx_id, 'voucher_number', v_voucher_no, 'new_balance', v_new_balance
  ));

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id, 'voucher_number', v_voucher_no, 'new_balance', v_new_balance,
    'replayed', false
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.issue_supplier_payment(UUID, UUID, NUMERIC, TEXT, UUID, DATE, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.issue_supplier_payment(UUID, UUID, NUMERIC, TEXT, UUID, DATE, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.increment_supplier_balance(
  p_supplier_id uuid,
  p_delta numeric,
  p_operation_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant    uuid;
  v_role      text;
  v_new       numeric;
  v_op_key    text;
  v_existing  jsonb;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_current_role();
  IF NOT public.app_has_permission('suppliers.manage') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل رصيد المورد' USING ERRCODE = '42501';
  END IF;

  IF p_operation_id IS NOT NULL THEN
    v_op_key := 'supplier_balance:' || p_operation_id::text;
    SELECT result INTO v_existing
      FROM public.stock_operations
     WHERE operation_id = v_op_key AND tenant_id = v_tenant;
    IF v_existing IS NOT NULL THEN
      RETURN (v_existing->>'new_balance')::numeric;
    END IF;
  END IF;

  UPDATE public.suppliers
     SET balance = round(COALESCE(balance, 0) + COALESCE(p_delta, 0), 2)
   WHERE id = p_supplier_id
     AND tenant_id = v_tenant
  RETURNING balance INTO v_new;

  IF v_new IS NULL THEN
    RAISE EXCEPTION 'supplier not found' USING ERRCODE = '02000';
  END IF;

  IF p_operation_id IS NOT NULL THEN
    INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
    VALUES (v_op_key, v_tenant, 'supplier_balance', jsonb_build_object('new_balance', v_new))
    ON CONFLICT (operation_id) DO NOTHING;
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_supplier_balance(uuid, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_supplier_balance(uuid, numeric, uuid) TO authenticated, service_role;
