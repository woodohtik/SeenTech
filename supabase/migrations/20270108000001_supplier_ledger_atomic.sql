-- seen-readiness-fixes-task.md P6 (MONEY-12) -- a supplier's balance and its
-- ledger line are written together, once.
--
--  * record_supplier_transaction(operation, supplier, type, credit, debit,
--    reference, date, notes): locks the supplier row, returns the existing
--    line if this operation was already recorded, otherwise moves the
--    balance and writes the ledger line with the balance it produced -- one
--    transaction, so the two can no longer disagree, and a retry (or two
--    concurrent calls with the same id) applies once. suppliers.manage.
--  * increment_supplier_balance (still called by installed apps): the
--    operation key is claimed before the balance moves, so two concurrent
--    calls with the same key no longer both apply it.
-- Rollback: supabase/rollbacks/20270108_supplier_ledger_atomic.down.sql

CREATE OR REPLACE FUNCTION public.record_supplier_transaction(
  p_operation_id uuid, p_supplier_id uuid, p_type text, p_credit numeric, p_debit numeric,
  p_reference text DEFAULT NULL, p_date timestamptz DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant  uuid := app_current_tenant_id();
  v_credit  numeric := round(COALESCE(p_credit, 0), 2);
  v_debit   numeric := round(COALESCE(p_debit, 0), 2);
  v_balance numeric;
  v_line    record;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT app_has_permission('suppliers.manage') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل رصيد المورد' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'معرّف العملية مطلوب' USING ERRCODE = '22023';
  END IF;
  IF v_credit < 0 OR v_debit < 0 OR (v_credit > 0 AND v_debit > 0) OR (v_credit = 0 AND v_debit = 0) THEN
    RAISE EXCEPTION 'المبلغ غير صالح: إما دائن أو مدين بمبلغ موجب' USING ERRCODE = '22023';
  END IF;

  -- The supplier's row first: concurrent operations on it wait here.
  SELECT balance INTO v_balance FROM public.suppliers WHERE id = p_supplier_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المورد غير موجود' USING ERRCODE = '02000';
  END IF;

  SELECT id, running_balance, tenant_id INTO v_line FROM public.supplier_transactions WHERE id = p_operation_id;
  IF v_line.id IS NOT NULL THEN
    IF v_line.tenant_id <> v_tenant THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('id', v_line.id, 'running_balance', v_line.running_balance, 'replayed', true);
  END IF;

  v_balance := round(COALESCE(v_balance, 0) + v_credit - v_debit, 2);
  UPDATE public.suppliers SET balance = v_balance WHERE id = p_supplier_id;
  INSERT INTO public.supplier_transactions (id, tenant_id, supplier_id, type, credit, debit, running_balance, reference_number, date, notes, created_by)
  VALUES (p_operation_id, v_tenant, p_supplier_id, left(COALESCE(p_type, 'adjustment'), 50), v_credit, v_debit, v_balance,
          left(p_reference, 100), COALESCE(p_date, now()), p_notes, app_actor_staff_id());
  RETURN jsonb_build_object('id', p_operation_id, 'running_balance', v_balance, 'replayed', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_supplier_transaction(uuid, uuid, text, numeric, numeric, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_transaction(uuid, uuid, text, numeric, numeric, text, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.increment_supplier_balance(p_supplier_id uuid, p_delta numeric, p_operation_id uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    uuid;
  v_new       numeric;
  v_op_key    text;
  v_existing  jsonb;
  v_claimed   boolean := false;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.app_has_permission('suppliers.manage') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل رصيد المورد' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NOT NULL THEN
    v_op_key := 'supplier_balance:' || p_operation_id::text;
    -- P6 (MONEY-12): claim the key before moving the balance. A concurrent
    -- call with the same key waits on this insert, then finds it taken.
    INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
    VALUES (v_op_key, v_tenant, 'supplier_balance', '{}'::jsonb)
    ON CONFLICT (operation_id) DO NOTHING
    RETURNING true INTO v_claimed;
    IF NOT COALESCE(v_claimed, false) THEN
      SELECT result INTO v_existing FROM public.stock_operations WHERE operation_id = v_op_key AND tenant_id = v_tenant;
      IF v_existing IS NULL OR NOT (v_existing ? 'new_balance') THEN
        RAISE EXCEPTION 'operation in progress' USING ERRCODE = '40001';
      END IF;
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
    UPDATE public.stock_operations SET result = jsonb_build_object('new_balance', v_new) WHERE operation_id = v_op_key;
  END IF;
  RETURN v_new;
END;
$function$;
