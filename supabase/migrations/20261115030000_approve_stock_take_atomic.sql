-- seen-cto-code-review-2026-11-13.md, سبرنت 1، البند 4 (C8).
--
-- POST /api/inventory-adjustments (server.ts:916-1039) runs entirely
-- through supabaseAdmin (service-role, bypasses RLS) with only
-- `authenticate` (valid JWT) in front of it -- no role/permission check
-- at all server-side. `hasApprovePermission` in InventoryAdjustment.tsx
-- is a client-side-only gate: any authenticated cashier can POST
-- `header.status: "Approved"` directly and immediately mutate stock.
-- The branch_inventory UPDATE/INSERT there also keys only on
-- (tenant_id, branch_id, item_id) -- no variant_id -- so counting one
-- variant of an item writes that single count onto every variant of
-- that item in the branch (a size M count overwrites size L's row too,
-- since both share the same item_id and the query has no variant
-- filter to tell them apart). It also writes the browser's absolute
-- "actual_qty" captured whenever the count screen was opened, not a
-- delta against the live quantity -- any sale that completes during the
-- count is silently erased by the eventual write. And the "rollback" on
-- a mid-batch ledger failure only deletes the adjustment header/detail
-- rows, never the branch_inventory rows the loop already wrote before
-- the failing line -- stock is left permanently wrong with no record of
-- why.
--
-- Fix: approve_stock_take(p_operation_id, p_branch_id, p_adjustment_type,
-- p_notes, p_lines, p_status) -- one atomic, idempotent, role-checked
-- RPC:
-- - Only owner/admin/manager may set p_status = 'Approved' (matches the
--   module's own copy: "بصفتك صرافاً سيتم حفظ هذه كمسودة معلقة"). Any
--   authenticated staff member may still save a 'Draft' (no stock
--   mutation at all, so no role risk there).
-- - Every line is applied through apply_stock_movement -- the same
--   variant-aware, idempotent function POS checkout and transfers
--   already use -- with the real variant_id threaded through, so a
--   count never touches a sibling variant's row.
-- - system_qty is read live inside the same transaction (`FOR UPDATE`),
--   never trusted from whatever the client had cached when the screen
--   opened, and the delta applied is (physical - live system_qty), not
--   an absolute overwrite -- a sale that completes mid-count is no
--   longer erased by the eventual approval.
-- - The whole operation is one Postgres function: a failure on any line
--   rolls back everything (header, details, every stock movement
--   already applied in the loop) instead of leaving partial stock
--   writes with the audit trail deleted out from under them.
-- - product_name/system_qty/reference_number are resolved/generated
--   server-side, not trusted from the client payload.

CREATE OR REPLACE FUNCTION public.approve_stock_take(
  p_operation_id    UUID,
  p_branch_id       UUID,
  p_adjustment_type TEXT,
  p_notes           TEXT,
  p_lines           JSONB,
  p_status          TEXT DEFAULT 'Draft'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant              uuid;
  v_staff               uuid;
  v_staff_name          text;
  v_role                text;
  v_op_key              text;
  v_existing            jsonb;

  v_adjustment_id       uuid;
  v_reference_number    text;

  v_line                jsonb;
  v_item_id             uuid;
  v_variant_id          uuid;
  v_physical            numeric;
  v_unit_cost           numeric;
  v_reason              text;
  v_system_qty          numeric;
  v_variance            numeric;
  v_total_variance_cost numeric;
  v_product_name        text;
  v_line_op_key         text;
  v_line_count          integer;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار الجرد' USING ERRCODE = '22023';
  END IF;

  IF p_status NOT IN ('Draft', 'Approved') THEN
    RAISE EXCEPTION 'حالة مستند غير صالحة' USING ERRCODE = '22023';
  END IF;

  v_line_count := COALESCE(jsonb_array_length(p_lines), 0);
  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'لا توجد أي مواد في مستند الجرد' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'approve_stock_take:' || p_operation_id::text;
  SELECT result INTO v_existing FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;
  v_role := public.app_current_role();

  IF p_status = 'Approved' AND (v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager')) THEN
    RAISE EXCEPTION 'لا تملك صلاحية اعتماد الجرد -- يمكنك حفظه كمسودة فقط' USING ERRCODE = '42501';
  END IF;

  v_reference_number := 'ADJ-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-'
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));

  INSERT INTO public.inventory_adjustments (
    tenant_id, branch_id, reference_number, status, adjustment_type,
    created_by, created_by_name, approved_by, approved_by_name, notes
  ) VALUES (
    v_tenant::text, p_branch_id::text, v_reference_number, p_status::adjustment_status,
    p_adjustment_type::adjustment_reason_type,
    v_staff::text, COALESCE(v_staff_name, 'Staff'),
    CASE WHEN p_status = 'Approved' THEN v_staff::text ELSE NULL END,
    CASE WHEN p_status = 'Approved' THEN COALESCE(v_staff_name, 'Staff') ELSE NULL END,
    p_notes
  ) RETURNING id INTO v_adjustment_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_item_id := NULLIF(v_line->>'item_id', '')::uuid;
    v_variant_id := NULLIF(v_line->>'variant_id', '')::uuid;
    v_physical := (v_line->>'physical_qty')::numeric;
    v_unit_cost := COALESCE((v_line->>'unit_cost')::numeric, 0);
    v_reason := NULLIF(v_line->>'reason', '');

    IF v_item_id IS NULL OR v_physical IS NULL THEN
      RAISE EXCEPTION 'سطر جرد غير صالح -- item_id و physical_qty مطلوبان' USING ERRCODE = '22023';
    END IF;

    SELECT name INTO v_product_name FROM public.inventory_items WHERE id = v_item_id;

    -- Live book quantity, scoped to the exact (branch, item, variant)
    -- triple -- never the client's cached snapshot, and never applied
    -- across every variant of the item at once.
    SELECT quantity INTO v_system_qty FROM public.branch_inventory
     WHERE tenant_id = v_tenant AND branch_id = p_branch_id AND item_id = v_item_id
       AND variant_id IS NOT DISTINCT FROM v_variant_id
     FOR UPDATE;
    v_system_qty := COALESCE(v_system_qty, 0);

    v_variance := round(v_physical - v_system_qty, 4);
    v_total_variance_cost := round(v_variance * v_unit_cost, 2);

    INSERT INTO public.adjustment_items (
      tenant_id, adjustment_id, product_id, product_name, system_qty, physical_qty,
      variance_qty, unit_cost, total_variance_cost, reason
    ) VALUES (
      v_tenant::text, v_adjustment_id, v_item_id::text, v_product_name,
      v_system_qty, v_physical, v_variance, v_unit_cost, v_total_variance_cost, v_reason
    );

    IF p_status = 'Approved' AND v_variance <> 0 THEN
      v_line_op_key := p_operation_id::text || ':item:' || v_item_id::text
        || COALESCE(':variant:' || v_variant_id::text, '');
      PERFORM public.apply_stock_movement(
        v_line_op_key, p_branch_id, v_item_id, v_variance, 'reconciliation',
        v_adjustment_id, 'adjustment', v_variant_id
      );
    END IF;
  END LOOP;

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'approve_stock_take', jsonb_build_object(
    'adjustment_id', v_adjustment_id, 'reference_number', v_reference_number, 'status', p_status
  ));

  RETURN jsonb_build_object(
    'adjustment_id', v_adjustment_id, 'reference_number', v_reference_number,
    'status', p_status, 'replayed', false
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.approve_stock_take(UUID, UUID, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.approve_stock_take(UUID, UUID, TEXT, TEXT, JSONB, TEXT) TO authenticated;
