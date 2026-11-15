-- seen-cto-code-review-2026-11-13.md, سبرنت 1، البند 6 (CASH-18، SUP-1/2/3
-- بحدود سند صرف المورد تحديداً -- انظر "محجوز" أدناه لما بقي من تلك البنود
-- خارج هذا السند).
--
-- PaymentVoucherModal.tsx calls addSupplierTransaction WITHOUT an
-- operationId (the one idempotency key supplierAccountsService.ts
-- actually supports), so every voucher is two separate, non-atomic
-- network round trips with no replay protection at all: (1)
-- increment_supplier_balance applies the debit, (2) a separate
-- .upsert() writes the ledger row. If step 2 fails -- network, RLS,
-- constraint -- the balance already moved, the catch block only does
-- `console.error` (no toast, nothing), the modal just sits there, and
-- pressing submit again debits the supplier a second time with a new
-- random "PV-" number. The voucher number itself
-- (`Math.floor(100000 + Math.random()*900000)`) is not sequential, has
-- no uniqueness constraint, and is printed on a document that looks
-- legally sequential. The cash-drawer leg (shift_entries payout) is a
-- third, separate, best-effort write after the ledger write -- wrapped
-- in its own try/catch that only logs to the console on failure -- so a
-- cash voucher can exist with no record of cash ever leaving the
-- drawer, which the code's own comment says it exists to prevent. And
-- neither the voucher amount (HTML `max` only) nor who may issue a
-- supplier payment at all is enforced anywhere in the database (SUP-15):
-- `/suppliers` is gated by a route permission, but the RPC and the
-- ledger table RLS only check tenant membership.
--
-- Fix: issue_supplier_payment(p_operation_id, p_supplier_id, p_amount,
-- p_method, p_shift_id, p_voucher_date, p_notes) -- one atomic,
-- idempotent, role-checked RPC: locks the supplier row, debits the
-- balance and inserts the ledger row and (for a cash payment with a
-- real open shift) the shift_entries payout row, all in the same
-- transaction, with a real sequential voucher number allocated
-- server-side. PaymentVoucherModal.tsx is switched to call only this
-- RPC for issuing a payment (not addSupplierTransaction/
-- increment_supplier_balance at all).
--
-- NOT in scope here (addSupplierTransaction/increment_supplier_balance
-- stay as they are for these other callers -- a broader SUP-2/SUP-15
-- fix covering every supplier-ledger writer is a separate, larger item):
-- - PurchaseReturns.tsx's own ledger posting (still the old two-step,
--   non-idempotent call) -- different flow (stock restocking + ledger),
--   needs its own atomic RPC design, not just a voucher number.
-- - Suppliers.tsx's opening-balance import (SUP-1) -- a different bug
--   (operationId isn't a UUID there) on a different code path.
-- - Tightening supplier_transactions RLS to insert-only / revoking
--   direct client EXECUTE on increment_supplier_balance(uuid,numeric,uuid)
--   -- both of the callers above still depend on calling that RPC and
--   writing that table directly from the client; closing that door only
--   after they're migrated too, not as a side effect of this item.
-- - The dead, truly unused 2-arg increment_supplier_balance(uuid,numeric)
--   overload (SUP-3's "drop it") IS removed below -- confirmed nothing
--   calls it (every real call already passes p_operation_id, even NULL).

DROP FUNCTION IF EXISTS public.increment_supplier_balance(uuid, numeric);

ALTER TABLE public.supplier_transactions ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.staff(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.tenant_voucher_counters (
  tenant_id            UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  next_voucher_number  BIGINT NOT NULL DEFAULT 1
);

INSERT INTO public.tenant_voucher_counters (tenant_id, next_voucher_number)
SELECT tenant_id, COUNT(*) + 1 FROM public.supplier_transactions WHERE type = 'payment' GROUP BY tenant_id
ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.allocate_tenant_voucher_number(p_tenant UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_num bigint;
BEGIN
  INSERT INTO public.tenant_voucher_counters (tenant_id) VALUES (p_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE public.tenant_voucher_counters
     SET next_voucher_number = next_voucher_number + 1
   WHERE tenant_id = p_tenant
  RETURNING next_voucher_number - 1 INTO v_num;

  RETURN v_num;
END $$;

REVOKE EXECUTE ON FUNCTION public.allocate_tenant_voucher_number(UUID) FROM PUBLIC, anon, authenticated;

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
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager', 'accountant') THEN
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
