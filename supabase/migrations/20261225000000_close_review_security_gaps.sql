-- The three older gaps the 2026-11-19 team review found underneath the new
-- tailoring work (مراجعة-الفريق-التقني-الكامل-2026-11-19.md: ع-2, ع-3, ع-4).
--
--   1. tenant_voucher_counters had no RLS and was granted to anon.
--   2. apply_stock_movement could be called by any signed-in staff member
--      with any delta, and did not check that the branch and item were the
--      caller's shop's.
--   3. Money columns on orders / order_items / payments could be changed by
--      a direct table write. UPDATE was already narrowed to owner/admin/
--      manager (20261122000000); INSERT was open to any staff member.
--
-- How a direct write is told from an internal one: by current_user. Every
-- function that owns these writes is SECURITY DEFINER, so inside one
-- current_user is the function's owner; in a request straight from the API it
-- is `authenticated`. That holds however the statement was reached, including
-- through any function that runs SQL with the caller's own rights.
--
-- No function changes its signature and no existing row is touched.

-- -----------------------------------------------------------------------
-- 1) tenant_voucher_counters: same lock-down as tenant_order_counters. The
--    only reader and writer is allocate_tenant_voucher_number, which is
--    SECURITY DEFINER and unaffected.
-- -----------------------------------------------------------------------
ALTER TABLE public.tenant_voucher_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_voucher_counters FROM PUBLIC, anon, authenticated;

-- An earlier draft of this migration, applied to staging only, defined this helper.
DROP FUNCTION IF EXISTS public.app_call_depth();

-- -----------------------------------------------------------------------
-- 2) apply_stock_movement
--
--    The work moves, unchanged, into app_private.apply_stock_movement_core.
--    app_private is not one of the schemas the API exposes, so the core
--    cannot be called from a browser; it gains only the check that the branch
--    and the item are the caller's shop's.
--
--    public.apply_stock_movement keeps its name and signature and becomes
--    the gate. It runs with the caller's rights, so it can see who is really
--    asking:
--      - a signed-in user calling it from the API (the manual add / set
--        balance dialog, the stock count screen, the purchase return screen)
--        needs inventory.reconcile or suppliers.manage;
--      - a function that owns a stock change (a sale, a return, a purchase
--        receipt, a stock take, the cutting-stage deduction) reaches it as
--        its own owner and passes straight through, having already checked
--        its caller.
-- -----------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app_private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.apply_stock_movement_core(
  p_operation_id   TEXT,
  p_branch_id      UUID,
  p_item_id        UUID,
  p_delta          NUMERIC,
  p_type           TEXT,
  p_reference_id   UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_variant_id     UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant   uuid;
  v_staff    uuid;
  v_prev     numeric;
  v_new      numeric;
  v_existing jsonb;
  v_delta    numeric;
BEGIN
  IF p_operation_id IS NULL OR btrim(p_operation_id) = '' THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار الحركة' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT result INTO v_existing
    FROM public.stock_operations
   WHERE operation_id = p_operation_id AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_delta := round(COALESCE(p_delta, 0)::numeric, 4);
  IF v_delta = 0 THEN
    RAISE EXCEPTION 'لا يوجد تغيير في الكمية' USING ERRCODE = '22023';
  END IF;

  -- The branch and the item must both be this shop's. Without this a caller
  -- could write a stock row of their own against another shop's ids.
  PERFORM 1 FROM public.branches WHERE id = p_branch_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.inventory_items WHERE id = p_item_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_staff := public.app_current_staff_id();

  SELECT quantity INTO v_prev
    FROM public.branch_inventory
   WHERE tenant_id = v_tenant
     AND branch_id = p_branch_id
     AND item_id   = p_item_id
     AND variant_id IS NOT DISTINCT FROM p_variant_id
   FOR UPDATE;

  IF v_prev IS NULL THEN
    IF v_delta < 0 THEN
      RAISE EXCEPTION 'لا يوجد رصيد لهذا الصنف في هذا الفرع' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, variant_id, quantity)
    VALUES (v_tenant, p_branch_id, p_item_id, p_variant_id, 0)
    ON CONFLICT DO NOTHING;

    SELECT quantity INTO v_prev
      FROM public.branch_inventory
     WHERE tenant_id = v_tenant AND branch_id = p_branch_id
       AND item_id = p_item_id AND variant_id IS NOT DISTINCT FROM p_variant_id
     FOR UPDATE;
    v_prev := COALESCE(v_prev, 0);
  END IF;

  v_new := round(v_prev + v_delta, 4);

  IF v_new < 0 THEN
    RAISE EXCEPTION 'الكمية المطلوبة غير متوفرة في المخزون (المتاح %، المطلوب %)',
      v_prev, abs(v_delta) USING ERRCODE = '23514';
  END IF;

  UPDATE public.branch_inventory
     SET quantity = v_new, updated_at = now()
   WHERE tenant_id = v_tenant AND branch_id = p_branch_id
     AND item_id = p_item_id AND variant_id IS NOT DISTINCT FROM p_variant_id;

  INSERT INTO public.stock_ledger (
    tenant_id, branch_id, item_id, variant_id, type,
    previous_quantity, new_quantity, change,
    reference_id, reference_type, staff_id, staff_name
  )
  VALUES (
    v_tenant, p_branch_id, p_item_id, p_variant_id, p_type::stock_movement_type,
    v_prev, v_new, v_delta,
    p_reference_id, p_reference_type, v_staff,
    (SELECT name FROM public.staff WHERE id = v_staff)
  );

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (p_operation_id, v_tenant, p_type,
          jsonb_build_object('previous', v_prev, 'new', v_new, 'change', v_delta));

  RETURN jsonb_build_object(
    'previous', v_prev, 'new', v_new, 'change', v_delta,
    'operation_id', p_operation_id, 'replayed', false
  );
END $$;

REVOKE EXECUTE ON FUNCTION app_private.apply_stock_movement_core(TEXT, UUID, UUID, NUMERIC, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION app_private.apply_stock_movement_core(TEXT, UUID, UUID, NUMERIC, TEXT, UUID, TEXT, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_stock_movement(
  p_operation_id   TEXT,
  p_branch_id      UUID,
  p_item_id        UUID,
  p_delta          NUMERIC,
  p_type           TEXT,
  p_reference_id   UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_variant_id     UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NOT public.app_has_permission('inventory.reconcile')
     AND NOT public.app_has_permission('suppliers.manage') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل المخزون' USING ERRCODE = '42501';
  END IF;

  RETURN app_private.apply_stock_movement_core(
    p_operation_id, p_branch_id, p_item_id, p_delta, p_type,
    p_reference_id, p_reference_type, p_variant_id
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.apply_stock_movement(TEXT, UUID, UUID, NUMERIC, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.apply_stock_movement(TEXT, UUID, UUID, NUMERIC, TEXT, UUID, TEXT, UUID) TO authenticated, service_role;

-- -----------------------------------------------------------------------
-- 3) Money columns change only through the functions that own them.
--
--    guard_financial_columns runs before a write to orders, order_items or
--    payments, and acts only on a signed-in user's own direct write. A write
--    made inside an owning function (create_pos_sale, create_tailoring_order,
--    record_order_payment, ...), by the service role, or by a migration is
--    not its business. For a direct write:
--      - orders UPDATE: the money columns, kind and fabric_deducted_at must
--        not change. Everything else (notes, dates, the assigned tailor, the
--        stage for those RLS allows) still can.
--      - orders INSERT: allowed (orders queued offline before
--        create_tailoring_order still drain this way), but not as a
--        tailoring-kind order and not already stamped as deducted.
--      - order_items / payments INSERT: refused. Nothing in the app writes
--        these directly any more.
--      - order_items / payments UPDATE: the amounts and what they are
--        attached to must not change.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_financial_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'orders' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.kind IS NOT NULL OR NEW.fabric_deducted_at IS NOT NULL THEN
        RAISE EXCEPTION 'هذا الطلب يُنشأ عبر النظام فقط' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
       OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
       OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate
       OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.fabric_deducted_at IS DISTINCT FROM OLD.fabric_deducted_at
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'مبالغ الطلب لا تُعدَّل مباشرة' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'order_items' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'أصناف الطلب تُضاف عبر النظام فقط' USING ERRCODE = '42501';
    ELSIF NEW.price IS DISTINCT FROM OLD.price
       OR NEW.quantity IS DISTINCT FROM OLD.quantity
       OR NEW.consumed_meters IS DISTINCT FROM OLD.consumed_meters
       OR NEW.fabric_id IS DISTINCT FROM OLD.fabric_id
       OR NEW.item_id IS DISTINCT FROM OLD.item_id
       OR NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'أصناف الطلب لا تُعدَّل مباشرة' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'payments' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'الدفعات تُسجَّل عبر النظام فقط' USING ERRCODE = '42501';
    ELSIF NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.method IS DISTINCT FROM OLD.method
       OR NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
       OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'الدفعات لا تُعدَّل مباشرة' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_financial_columns ON public.orders;
CREATE TRIGGER trg_guard_financial_columns
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_financial_columns();

DROP TRIGGER IF EXISTS trg_guard_financial_columns ON public.order_items;
CREATE TRIGGER trg_guard_financial_columns
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_financial_columns();

DROP TRIGGER IF EXISTS trg_guard_financial_columns ON public.payments;
CREATE TRIGGER trg_guard_financial_columns
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_financial_columns();
