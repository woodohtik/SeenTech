-- =============================================================================
-- seen-cto-sprint4-permissions-task.md item 1 (CTO review section 6/3,
-- confirmed by a dedicated security audit, not assumed): increment_supplier_balance
-- checked only app_current_tenant_id() -- any staff member with a valid
-- session for the tenant (a cashier, never shown the /suppliers screen at
-- all) could call supabase.rpc('increment_supplier_balance', {p_supplier_id,
-- p_delta: -999999}) directly from the browser console and drain or inflate
-- a supplier's balance, with no gate anywhere. Same gap in
-- supplier_transactions' single tenant-only RLS policy -- direct
-- INSERT/UPDATE/DELETE on the supplier ledger was open to every role.
--
-- Same role set as issue_supplier_payment (20261115060000, SUP-15) for
-- consistency: owner/admin/manager (operational authority) + accountant
-- (the role this exists for).
-- =============================================================================

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
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager', 'accountant') THEN
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

-- supplier_transactions_tenant_isolation was a single FOR ALL policy
-- (tenant match only) -- split so every tenant member can still read the
-- ledger (SELECT), but writing it directly (bypassing
-- issue_supplier_payment/create_purchase_order, both SECURITY DEFINER and
-- therefore unaffected by RLS) requires the same operational roles above.
DROP POLICY IF EXISTS supplier_transactions_tenant_isolation ON public.supplier_transactions;

CREATE POLICY supplier_transactions_tenant_select ON public.supplier_transactions
    FOR SELECT TO authenticated
    USING (app_is_super_admin() OR tenant_id = app_current_tenant_id());

CREATE POLICY supplier_transactions_tenant_write ON public.supplier_transactions
    FOR INSERT TO authenticated
    WITH CHECK (
      app_is_super_admin()
      OR (tenant_id = app_current_tenant_id() AND app_current_role() IN ('owner', 'admin', 'manager', 'accountant'))
    );

CREATE POLICY supplier_transactions_tenant_update ON public.supplier_transactions
    FOR UPDATE TO authenticated
    USING (
      app_is_super_admin()
      OR (tenant_id = app_current_tenant_id() AND app_current_role() IN ('owner', 'admin', 'manager', 'accountant'))
    )
    WITH CHECK (
      app_is_super_admin()
      OR (tenant_id = app_current_tenant_id() AND app_current_role() IN ('owner', 'admin', 'manager', 'accountant'))
    );

CREATE POLICY supplier_transactions_tenant_delete ON public.supplier_transactions
    FOR DELETE TO authenticated
    USING (
      app_is_super_admin()
      OR (tenant_id = app_current_tenant_id() AND app_current_role() IN ('owner', 'admin', 'manager', 'accountant'))
    );
