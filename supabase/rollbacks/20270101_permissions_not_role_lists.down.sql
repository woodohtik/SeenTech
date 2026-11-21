-- Rollback of 20270101000002_permissions_not_role_lists.sql: the role lists as they were.

DROP POLICY IF EXISTS orders_tenant_update ON public.orders;
CREATE POLICY orders_tenant_update ON public.orders FOR UPDATE TO public
  USING ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))))
  WITH CHECK ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

DROP POLICY IF EXISTS order_items_tenant_update ON public.order_items;
CREATE POLICY order_items_tenant_update ON public.order_items FOR UPDATE TO public
  USING ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))))
  WITH CHECK ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

DROP POLICY IF EXISTS order_items_tenant_delete ON public.order_items;
CREATE POLICY order_items_tenant_delete ON public.order_items FOR DELETE TO public
  USING ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

DROP POLICY IF EXISTS payments_tenant_update ON public.payments;
CREATE POLICY payments_tenant_update ON public.payments FOR UPDATE TO public
  USING ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))))
  WITH CHECK ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

DROP POLICY IF EXISTS payments_tenant_delete ON public.payments;
CREATE POLICY payments_tenant_delete ON public.payments FOR DELETE TO public
  USING ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

DROP POLICY IF EXISTS shifts_tenant_update ON public.shifts;
CREATE POLICY shifts_tenant_update ON public.shifts FOR UPDATE TO public
  USING ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))))
  WITH CHECK ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

DROP POLICY IF EXISTS shifts_tenant_delete ON public.shifts;
CREATE POLICY shifts_tenant_delete ON public.shifts FOR DELETE TO public
  USING ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

DROP POLICY IF EXISTS shift_entries_tenant_update ON public.shift_entries;
CREATE POLICY shift_entries_tenant_update ON public.shift_entries FOR UPDATE TO public
  USING ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))))
  WITH CHECK ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

DROP POLICY IF EXISTS shift_entries_tenant_delete ON public.shift_entries;
CREATE POLICY shift_entries_tenant_delete ON public.shift_entries FOR DELETE TO public
  USING ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

DROP POLICY IF EXISTS sales_returns_tenant_update ON public.sales_returns;
CREATE POLICY sales_returns_tenant_update ON public.sales_returns FOR UPDATE TO public
  USING ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))))
  WITH CHECK ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

DROP POLICY IF EXISTS sales_returns_tenant_delete ON public.sales_returns;
CREATE POLICY sales_returns_tenant_delete ON public.sales_returns FOR DELETE TO public
  USING ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text])))));

DROP POLICY IF EXISTS inventory_items_tenant_insert ON public.inventory_items;
CREATE POLICY inventory_items_tenant_insert ON public.inventory_items FOR INSERT TO public
  WITH CHECK ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM staff s
  WHERE ((s.uid = app_current_uid()) AND (s.status = 'active'::staff_status) AND (s.tenant_id = inventory_items.tenant_id) AND (s.role = ANY (ARRAY['owner'::user_role, 'admin'::user_role, 'manager'::user_role, 'branch_manager'::user_role, 'warehouse_manager'::user_role]))))))));

DROP POLICY IF EXISTS inventory_items_tenant_update ON public.inventory_items;
CREATE POLICY inventory_items_tenant_update ON public.inventory_items FOR UPDATE TO public
  USING ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM staff s
  WHERE ((s.uid = app_current_uid()) AND (s.status = 'active'::staff_status) AND (s.tenant_id = inventory_items.tenant_id) AND (s.role = ANY (ARRAY['owner'::user_role, 'admin'::user_role, 'manager'::user_role, 'branch_manager'::user_role, 'warehouse_manager'::user_role]))))))))
  WITH CHECK ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM staff s
  WHERE ((s.uid = app_current_uid()) AND (s.status = 'active'::staff_status) AND (s.tenant_id = inventory_items.tenant_id) AND (s.role = ANY (ARRAY['owner'::user_role, 'admin'::user_role, 'manager'::user_role, 'branch_manager'::user_role, 'warehouse_manager'::user_role]))))))));

DROP POLICY IF EXISTS branch_inventory_tenant_insert ON public.branch_inventory;
CREATE POLICY branch_inventory_tenant_insert ON public.branch_inventory FOR INSERT TO public
  WITH CHECK ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM staff s
  WHERE ((s.uid = app_current_uid()) AND (s.status = 'active'::staff_status) AND (s.tenant_id = branch_inventory.tenant_id) AND (s.role = ANY (ARRAY['owner'::user_role, 'admin'::user_role, 'manager'::user_role, 'branch_manager'::user_role, 'warehouse_manager'::user_role]))))))));

DROP POLICY IF EXISTS branch_inventory_tenant_update ON public.branch_inventory;
CREATE POLICY branch_inventory_tenant_update ON public.branch_inventory FOR UPDATE TO public
  USING ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM staff s
  WHERE ((s.uid = app_current_uid()) AND (s.status = 'active'::staff_status) AND (s.tenant_id = branch_inventory.tenant_id) AND (s.role = ANY (ARRAY['owner'::user_role, 'admin'::user_role, 'manager'::user_role, 'branch_manager'::user_role, 'warehouse_manager'::user_role]))))))))
  WITH CHECK ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM staff s
  WHERE ((s.uid = app_current_uid()) AND (s.status = 'active'::staff_status) AND (s.tenant_id = branch_inventory.tenant_id) AND (s.role = ANY (ARRAY['owner'::user_role, 'admin'::user_role, 'manager'::user_role, 'branch_manager'::user_role, 'warehouse_manager'::user_role]))))))));

DROP POLICY IF EXISTS customers_tenant_insert ON public.customers;
CREATE POLICY customers_tenant_insert ON public.customers FOR INSERT TO public
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS customers_tenant_update ON public.customers;
CREATE POLICY customers_tenant_update ON public.customers FOR UPDATE TO public
  USING ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())))
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS staff_tenant_delete ON public.staff;
CREATE POLICY staff_tenant_delete ON public.staff FOR DELETE TO public
  USING ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text])))));

DROP POLICY IF EXISTS staff_tenant_insert ON public.staff;
CREATE POLICY staff_tenant_insert ON public.staff FOR INSERT TO public
  WITH CHECK ((app_is_super_admin() OR ((tenant_id = app_current_tenant_id()) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text])) AND ((role <> 'owner'::user_role) OR (app_current_role() = 'owner'::text)))));

DROP POLICY IF EXISTS saas_settings_public_read ON public.saas_settings;
CREATE POLICY saas_settings_public_read ON public.saas_settings FOR SELECT TO authenticated
  USING ((app_is_super_admin() OR (key = ANY (ARRAY['branding'::text, 'bank_transfer'::text, 'referral_program'::text])) OR ((key = 'support_access_requests'::text) AND (app_current_role() = ANY (ARRAY['owner'::text, 'admin'::text])))));

CREATE OR REPLACE FUNCTION public.update_order_status(p_order_id uuid, p_status text, p_status_key text, p_notes text DEFAULT NULL::text, p_op_id uuid DEFAULT NULL::uuid, p_history_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant      uuid;
  v_role        text;
  v_staff       uuid;
  v_staff_name  text;
  v_op_key      text;
  v_existing    jsonb;
  v_total       numeric;
  v_paid        numeric;
  v_status      order_status;
  v_kind        text;
  v_deducted    timestamptz;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_current_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager', 'cashier', 'tailor') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل حالة الطلب' USING ERRCODE = '42501';
  END IF;

  IF p_op_id IS NOT NULL THEN
    v_op_key := 'update_order_status:' || p_op_id::text;
    SELECT result INTO v_existing FROM public.stock_operations
     WHERE operation_id = v_op_key AND tenant_id = v_tenant;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing || jsonb_build_object('replayed', true);
    END IF;
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;

  SELECT total_amount, paid_amount, status, kind, fabric_deducted_at
    INTO v_total, v_paid, v_status, v_kind, v_deducted
    FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_status IN ('delivered', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن تعديل طلب تم تسليمه أو إلغاؤه' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'delivered' AND round(v_total - v_paid, 2) > 0 THEN
    RAISE EXCEPTION 'لا يمكن تسليم طلب عليه مبلغ متبقٍ' USING ERRCODE = '23514';
  END IF;

  UPDATE public.orders SET
    status      = p_status::order_status,
    status_key  = p_status_key,
    notes       = CASE WHEN v_kind = 'tailoring' THEN notes ELSE COALESCE(p_notes, notes) END,
    updated_at  = now()
  WHERE id = p_order_id;

  -- order_status sorts measurements_taken < cutting < ... < delivered <
  -- cancelled, so "cutting or later, not cancelled" is a range check.
  IF v_kind = 'tailoring' AND v_deducted IS NULL
     AND p_status::order_status >= 'cutting'::order_status
     AND p_status::order_status <> 'cancelled'::order_status THEN
    PERFORM public.deduct_order_fabric(p_order_id, NULL);
  END IF;

  INSERT INTO public.order_history (tenant_id, order_id, status, notes, updated_by_staff, updated_by_name)
  VALUES (v_tenant, p_order_id, p_status::order_status, p_history_note, v_staff, COALESCE(v_staff_name, 'Staff'));

  IF p_op_id IS NOT NULL THEN
    INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
    VALUES (v_op_key, v_tenant, 'update_order_status', jsonb_build_object(
      'order_id', p_order_id, 'status', p_status, 'status_key', p_status_key
    ));
  END IF;

  RETURN jsonb_build_object('order_id', p_order_id, 'status', p_status, 'status_key', p_status_key, 'replayed', false);
END $function$;

CREATE OR REPLACE FUNCTION public.update_order_status_with_fabric(p_order_id uuid, p_status text, p_status_key text, p_fabric_lines jsonb, p_notes text DEFAULT NULL::text, p_op_id uuid DEFAULT NULL::uuid, p_history_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_max_per_piece CONSTANT numeric := 15;
  c_max_legacy    CONSTANT numeric := 100;
  v_tenant    uuid;
  v_role      text;
  v_kind      text;
  v_deducted  timestamptz;
  v_notes     text;
  v_meta      jsonb;
  v_line      jsonb;
  v_meters    numeric;
  v_stored    numeric;
  v_qty       numeric;
  v_fabric    uuid;
  v_changes   text := '';
  v_note      text := p_history_note;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_current_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager', 'cashier', 'tailor') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل حالة الطلب' USING ERRCODE = '42501';
  END IF;

  SELECT kind, fabric_deducted_at, notes INTO v_kind, v_deducted, v_notes
    FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_deducted IS NULL AND jsonb_typeof(p_fabric_lines) = 'array'
     AND p_status::order_status >= 'cutting'::order_status
     AND p_status::order_status <> 'cancelled'::order_status THEN

    IF v_kind = 'tailoring' THEN
      FOR v_line IN SELECT * FROM jsonb_array_elements(p_fabric_lines) LOOP
        v_meters := NULLIF(v_line->>'meters', '')::numeric;
        IF v_meters IS NULL OR v_meters < 0 THEN
          RAISE EXCEPTION 'كمية القماش غير صالحة' USING ERRCODE = '22023';
        END IF;

        -- The line must be one of this order's own stock-cloth lines.
        SELECT COALESCE(consumed_meters, 0), quantity INTO v_stored, v_qty
          FROM public.order_items
         WHERE id = NULLIF(v_line->>'line_key', '')::uuid
           AND order_id = p_order_id AND tenant_id = v_tenant
           AND type = 'custom' AND fabric_id IS NOT NULL;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'سطر القماش لا يتبع هذا الطلب' USING ERRCODE = '42501';
        END IF;

        IF v_meters > c_max_per_piece * GREATEST(v_qty, 1) THEN
          RAISE EXCEPTION 'كمية القماش (% م) أكبر من الحد المسموح لهذا السطر (% م)',
            v_meters, c_max_per_piece * GREATEST(v_qty, 1) USING ERRCODE = '22023';
        END IF;

        IF v_meters IS DISTINCT FROM v_stored THEN
          v_changes := v_changes || CASE WHEN v_changes = '' THEN '' ELSE '، ' END
                       || v_stored::text || ' ← ' || v_meters::text || ' م';
          UPDATE public.order_items
             SET consumed_meters = v_meters
           WHERE id = (v_line->>'line_key')::uuid;
        END IF;
      END LOOP;

    ELSE
      -- An older order keeps its lines inside `notes`. Read them from the
      -- STORED notes (not from p_notes, which the caller supplies) and accept
      -- a deduction only for a cloth one of those lines names.
      v_meta := NULL;
      IF v_notes LIKE '\_\_ORDER\_%:{%' THEN
        BEGIN
          v_meta := substring(v_notes FROM position(':' IN v_notes) + 1)::jsonb;
        EXCEPTION WHEN OTHERS THEN
          v_meta := NULL;
        END;
      END IF;
      IF v_meta IS NULL OR jsonb_typeof(v_meta->'items') <> 'array' THEN
        RAISE EXCEPTION 'تعذّر التحقق من أصناف الطلب لخصم القماش' USING ERRCODE = '22023';
      END IF;

      FOR v_line IN SELECT * FROM jsonb_array_elements(p_fabric_lines) LOOP
        v_meters := NULLIF(v_line->>'meters', '')::numeric;
        v_fabric := NULLIF(v_line->>'fabric_id', '')::uuid;
        IF v_meters IS NULL OR v_meters < 0 OR v_meters > c_max_legacy THEN
          RAISE EXCEPTION 'كمية القماش غير صالحة' USING ERRCODE = '22023';
        END IF;
        IF v_fabric IS NULL OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_meta->'items') it
           WHERE it->>'fabricId' = v_fabric::text
        ) THEN
          RAISE EXCEPTION 'القماش لا يتبع هذا الطلب' USING ERRCODE = '42501';
        END IF;
      END LOOP;

      PERFORM public.deduct_order_fabric(p_order_id, p_fabric_lines);
    END IF;
  END IF;

  IF v_changes <> '' THEN
    v_note := COALESCE(NULLIF(p_history_note, '') || ' | ', '') || 'تعديل كمية القماش عند القص: ' || v_changes;
  END IF;

  RETURN public.update_order_status(p_order_id, p_status, p_status_key, p_notes, p_op_id, v_note);
END $function$;

CREATE OR REPLACE FUNCTION public.record_order_payment(p_operation_id uuid, p_order_id uuid, p_amount numeric, p_method payment_method, p_shift_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_complete_status text DEFAULT NULL::text, p_complete_status_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- payment_method is no longer touched here -- it reflects the order's
  -- original/primary payment, set once at creation (Orders.tsx form /
  -- create_pos_sale); a later partial settlement must not silently
  -- relabel the whole order by whatever method happened to pay it off.
  IF v_completed THEN
    UPDATE public.orders SET
      paid_amount = v_new_paid,
      status = p_complete_status::order_status,
      status_key = p_complete_status_key,
      updated_at = now()
    WHERE id = p_order_id;
  ELSE
    UPDATE public.orders SET
      paid_amount = v_new_paid,
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
END $function$;

CREATE OR REPLACE FUNCTION public.issue_credit_note(p_operation_id uuid, p_invoice_id uuid, p_amount numeric, p_reason text DEFAULT NULL::text, p_refund_method payment_method DEFAULT 'cash'::payment_method)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.issue_tax_invoice_for_order(p_operation_id uuid, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant              uuid;
  v_staff               uuid;
  v_role                text;
  v_op_key              text;
  v_existing            jsonb;

  v_invoice_id          uuid;
  v_existing_number     text;

  v_order               RECORD;
  v_seller_name         text;
  v_seller_trn          text;
  v_buyer_trn           text;
  v_tax_enabled         boolean;

  v_subtotal            numeric;
  v_invoice_number      bigint;
  v_invoice_number_str  text;
  v_prev_hash           text;
  v_invoice_hash        text;
  v_qr_code             text;
  v_items_json          jsonb;
  v_notes               text;
  v_now                 timestamptz := now();
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار إصدار الفاتورة' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_current_role();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager', 'accountant') THEN
    RAISE EXCEPTION 'إصدار الفاتورة الضريبية يتطلب صلاحية owner أو admin أو manager أو accountant' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'issue_tax_invoice_for_order:' || p_operation_id::text;
  SELECT result INTO v_existing FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO v_order FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'لا يمكن إصدار فاتورة لطلب مُلغى' USING ERRCODE = '22023';
  END IF;

  IF v_order.status <> 'delivered' AND round(COALESCE(v_order.total_amount, 0) - COALESCE(v_order.paid_amount, 0), 2) > 0 THEN
    RAISE EXCEPTION 'لا يمكن إصدار فاتورة لطلب غير مدفوع بالكامل أو غير مُسلَّم' USING ERRCODE = '22023';
  END IF;

  -- Re-checked here, AFTER the order's own FOR UPDATE lock above (not
  -- just once before it): the lock serializes concurrent calls for the
  -- SAME order_id, so this is the check that actually prevents two
  -- concurrent "إصدار" clicks from both inserting an invoice -- the
  -- UNIQUE constraint added by this same migration is the backstop if a
  -- future write path misses this pattern entirely.
  SELECT id, invoice_number INTO v_invoice_id, v_existing_number
    FROM public.tax_invoices WHERE tenant_id = v_tenant AND order_id = p_order_id;
  IF v_invoice_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'invoice_id', v_invoice_id, 'invoice_number', v_existing_number,
      'already_existed', true, 'replayed', false
    );
  END IF;

  v_staff := public.app_current_staff_id();

  SELECT is_tax_enabled, name, vat_number INTO v_tax_enabled, v_seller_name, v_seller_trn
    FROM public.tenants WHERE id = v_tenant;
  v_tax_enabled := COALESCE(v_tax_enabled, false);

  IF v_order.customer_id IS NOT NULL THEN
    SELECT vat_number INTO v_buyer_trn FROM public.customers WHERE id = v_order.customer_id;
  END IF;

  -- Same wall create_pos_sale already enforces: never issue a tax invoice
  -- under a blank/unconfigured seller identity.
  IF v_tax_enabled AND (COALESCE(v_seller_name, '') = '' OR COALESCE(v_seller_trn, '') = '') THEN
    RAISE EXCEPTION 'أكمل الاسم التجاري والرقم الضريبي في الإعدادات قبل إصدار أي فاتورة'
      USING ERRCODE = '22023';
  END IF;

  -- orders.total_amount/tax_amount are already the authoritative, final
  -- figures for this order (the same columns close_shift and
  -- record_order_payment already treat as such) -- subtotal is simply
  -- backed out of them, the same way create_pos_sale derives it from its
  -- own server-computed total/tax rather than a separately stored value.
  v_subtotal := round(COALESCE(v_order.total_amount, 0) - COALESCE(v_order.tax_amount, 0), 2);

  -- Same items shape POS.tsx's own cart mapping encodes (name, quantity,
  -- price, type) -- built from this order's actual order_items rows so a
  -- late-issued invoice shows the same lines a POS-checkout invoice would.
  SELECT jsonb_agg(jsonb_build_object(
           'name', COALESCE(oi.name, oi.garment_type, 'منتج'),
           'quantity', oi.quantity,
           'price', oi.price,
           'type', oi.type::text
         ) ORDER BY oi.created_at)
    INTO v_items_json
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id AND oi.tenant_id = v_tenant;

  v_notes := '__INVOICE_EXT_METADATA__:' || jsonb_build_object(
    'items', COALESCE(v_items_json, '[]'::jsonb),
    'created_by', COALESCE((SELECT name FROM public.staff WHERE id = v_staff), 'Staff')
  )::text;

  v_invoice_number := public.allocate_tenant_invoice_number(v_tenant);
  v_invoice_number_str := 'INV-' || v_invoice_number::text;

  v_qr_code := CASE WHEN v_tax_enabled AND COALESCE(v_seller_trn, '') <> ''
    THEN public.zatca_qr_payload(v_seller_name, v_seller_trn, v_now, v_order.total_amount::text, v_order.tax_amount::text)
    ELSE NULL END;

  INSERT INTO public.zatca_invoice_chain_state (tenant_id)
  VALUES (v_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT last_invoice_hash INTO v_prev_hash
    FROM public.zatca_invoice_chain_state
   WHERE tenant_id = v_tenant
   FOR UPDATE;

  v_invoice_hash := encode(
    extensions.digest(
      COALESCE(v_prev_hash, '') || '|' || v_tenant::text || '|' ||
      v_invoice_number_str || '|' || v_order.total_amount::text || '|' ||
      v_order.tax_amount::text || '|' || v_now::text,
      'sha256'
    ),
    'base64'
  );

  UPDATE public.zatca_invoice_chain_state
     SET last_invoice_hash = v_invoice_hash, last_invoice_id = p_order_id, updated_at = v_now
   WHERE tenant_id = v_tenant;

  INSERT INTO public.tax_invoices (
    tenant_id, order_id, invoice_number, customer_id, customer_name,
    subtotal, tax_rate, tax_amount, discount_amount, paid_amount, total_amount,
    vat_number, qr_payload, issued_at, created_at, status, notes,
    invoice_hash, previous_invoice_hash
  ) VALUES (
    v_tenant, p_order_id, v_invoice_number_str, v_order.customer_id, v_order.customer_name,
    v_subtotal, v_order.tax_rate, v_order.tax_amount, v_order.discount_amount,
    v_order.paid_amount, v_order.total_amount,
    v_buyer_trn, v_qr_code, v_now, v_now, 'issued', v_notes,
    v_invoice_hash, v_prev_hash
  ) RETURNING id INTO v_invoice_id;

  BEGIN
    INSERT INTO public.employee_activity_logs (tenant_id, staff_id, staff_name, action, details, occurred_at)
    VALUES (v_tenant, v_staff, COALESCE((SELECT name FROM public.staff WHERE id = v_staff), 'Staff'), 'create_invoice',
            'إصدار فاتورة متأخرة لطلب موجود رقم ' || COALESCE(v_order.order_number::text, '') ||
              ' بقيمة ' || v_order.total_amount::text, v_now);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'issue_tax_invoice_for_order', jsonb_build_object(
    'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number_str, 'already_existed', false
  ));

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id, 'invoice_number', v_invoice_number_str,
    'already_existed', false, 'replayed', false
  );
END $function$;
