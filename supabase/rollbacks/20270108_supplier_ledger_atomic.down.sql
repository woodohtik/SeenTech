-- Rollback of 20270108000001_supplier_ledger_atomic.sql
DROP FUNCTION IF EXISTS public.record_supplier_transaction(uuid, uuid, text, numeric, numeric, text, timestamptz, text);
CREATE OR REPLACE FUNCTION public.increment_supplier_balance(p_supplier_id uuid, p_delta numeric, p_operation_id uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
