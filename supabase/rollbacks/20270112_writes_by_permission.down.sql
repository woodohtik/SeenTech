-- Rollback of 20270112000001_writes_by_permission.sql: the definitions and policies as they were.

CREATE OR REPLACE FUNCTION public.request_withdrawal(p_tenant uuid, p_amount numeric, p_iban text, p_beneficiary text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance  numeric;
  v_id       uuid;
  v_settings jsonb;
  v_min      numeric;
BEGIN
  IF p_tenant IS DISTINCT FROM app_current_tenant_id() THEN
    RAISE EXCEPTION 'Forbidden: can only withdraw from your own tenant''s wallet';
  END IF;

  SELECT value INTO v_settings FROM public.saas_settings WHERE key = 'referral_program';
  v_min := COALESCE((v_settings->>'minWithdrawal')::numeric, 1000);

  SELECT balance INTO v_balance FROM public.referral_wallets WHERE tenant_id = p_tenant FOR UPDATE;
  IF v_balance IS NULL OR v_balance <= v_min THEN
    RAISE EXCEPTION 'الحد الأدنى للسحب أكثر من % ر.س', v_min;
  END IF;
  IF p_amount <= v_min OR p_amount > v_balance THEN
    RAISE EXCEPTION 'مبلغ غير صالح';
  END IF;

  UPDATE public.referral_wallets SET balance = balance - p_amount, updated_at = now() WHERE tenant_id = p_tenant;
  INSERT INTO public.withdrawal_requests (tenant_id, amount, iban, beneficiary, status)
    VALUES (p_tenant, p_amount, p_iban, p_beneficiary, 'pending') RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_purchase_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant          uuid;
  v_order           RECORD;
  v_item            RECORD;
  v_order_type      text;
  v_target_status   purchase_order_status;
  v_branch_id       uuid;
  v_item_delta      numeric;
  v_balance_delta   numeric;
  v_new_balance     numeric;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order
    FROM public.purchase_orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'سند الشراء غير موجود أو لا ينتمي لهذا المستأجر' USING ERRCODE = '42501';
  END IF;

  IF v_order.status IN ('received', 'returned') THEN
    RETURN jsonb_build_object('purchase_order_id', p_order_id, 'status', v_order.status, 'replayed', true);
  END IF;

  v_order_type    := CASE WHEN v_order.po_number LIKE 'RET%' THEN 'return' ELSE 'purchase' END;
  v_target_status := CASE WHEN v_order_type = 'purchase' THEN 'received' ELSE 'returned' END;

  v_branch_id := v_order.branch_id;
  IF v_branch_id IS NULL THEN
    SELECT id INTO v_branch_id FROM public.branches WHERE tenant_id = v_tenant LIMIT 1;
  END IF;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'لا يوجد فرع لتسجيل حركة المخزون عليه' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT * FROM public.purchase_order_items WHERE purchase_order_id = p_order_id
  LOOP
    CONTINUE WHEN v_item.item_id IS NULL;

    v_item_delta := COALESCE(v_item.base_quantity, v_item.quantity, 0);
    IF v_order_type = 'return' THEN v_item_delta := -v_item_delta; END IF;
    CONTINUE WHEN v_item_delta = 0;

    PERFORM public.apply_stock_movement(
      p_operation_id   => 'po:' || p_order_id::text || ':item:' || v_item.item_id::text
                          || COALESCE(':variant:' || v_item.variant_id::text, ''),
      p_branch_id      => v_branch_id,
      p_item_id        => v_item.item_id,
      p_delta          => v_item_delta,
      p_type           => CASE WHEN v_item_delta > 0 THEN 'addition' ELSE 'deduction' END,
      p_reference_id   => p_order_id,
      p_reference_type => v_order_type,
      p_variant_id     => v_item.variant_id
    );
  END LOOP;

  IF v_order.supplier_id IS NOT NULL AND v_order.total_amount <> 0 THEN
    v_balance_delta := CASE WHEN v_order_type = 'purchase' THEN v_order.total_amount ELSE -v_order.total_amount END;

    v_new_balance := public.increment_supplier_balance(v_order.supplier_id, v_balance_delta, p_order_id);

    INSERT INTO public.supplier_transactions (
      id, tenant_id, supplier_id, type, credit, debit,
      running_balance, reference_number, date, notes
    ) VALUES (
      p_order_id, v_tenant, v_order.supplier_id,
      CASE WHEN v_order_type = 'purchase' THEN 'purchase' ELSE 'adjustment' END,
      CASE WHEN v_order_type = 'purchase' THEN v_order.total_amount ELSE 0 END,
      CASE WHEN v_order_type = 'purchase' THEN 0 ELSE v_order.total_amount END,
      v_new_balance,
      COALESCE(NULLIF(v_order.po_number, ''), 'PO-' || upper(right(p_order_id::text, 6))),
      now(),
      CASE WHEN v_order_type = 'purchase'
        THEN 'شراء بضائع ومواد بموجب أمر الشراء رقم ' || COALESCE(NULLIF(v_order.po_number, ''), upper(right(p_order_id::text, 6)))
        ELSE 'مرتجع بضائع ومواد بموجب سند إرجاع رقم ' || COALESCE(NULLIF(v_order.po_number, ''), upper(right(p_order_id::text, 6)))
      END
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  UPDATE public.purchase_orders
     SET status = v_target_status, received_date = now(), updated_at = now()
   WHERE id = p_order_id;

  RETURN jsonb_build_object('purchase_order_id', p_order_id, 'status', v_target_status, 'replayed', false);
END $function$;

CREATE OR REPLACE FUNCTION public.enforce_orders_plan_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id    text;
  v_max_orders int;
  v_current    int;
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  SELECT plan_id INTO v_plan_id FROM public.tenants WHERE id = NEW.tenant_id;
  IF v_plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT max_orders INTO v_max_orders FROM public.plans WHERE id = v_plan_id;
  -- P6 (PLATFORM-14): no limit when the plan has none -- NULL or 0 (0 used
  -- to block every order).
  IF v_max_orders IS NULL OR v_max_orders <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_current
    FROM public.orders
   WHERE tenant_id = NEW.tenant_id
     AND status <> 'cancelled'
     AND order_date >= date_trunc('month', now());

  IF v_current >= v_max_orders THEN
    -- Kept short (<100 chars) on purpose: getFriendlyErrorMessage
    -- (src/lib/firebase.ts) passes a Postgres error message straight
    -- through to the toast only below that length, else it falls back
    -- to a fully generic message.
    RAISE EXCEPTION 'تجاوزت باقتك الحد الأقصى لعدد الطلبات الشهرية (%)', v_max_orders
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_orders_plan_limit_reopen ON public.orders;

DROP TRIGGER IF EXISTS audit_logs_actor_is_caller ON public.audit_logs;
DROP TRIGGER IF EXISTS security_logs_actor_is_caller ON public.security_logs;
DROP FUNCTION IF EXISTS public.log_actor_is_caller();

DROP POLICY IF EXISTS branches_tenant_insert ON public.branches;
CREATE POLICY branches_tenant_insert ON public.branches FOR INSERT
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS branches_tenant_update ON public.branches;
CREATE POLICY branches_tenant_update ON public.branches FOR UPDATE
  USING ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())))
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS branches_tenant_delete ON public.branches;
CREATE POLICY branches_tenant_delete ON public.branches FOR DELETE
  USING ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS purchase_orders_tenant_insert ON public.purchase_orders;
CREATE POLICY purchase_orders_tenant_insert ON public.purchase_orders FOR INSERT
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS purchase_orders_tenant_update ON public.purchase_orders;
CREATE POLICY purchase_orders_tenant_update ON public.purchase_orders FOR UPDATE
  USING ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())))
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS purchase_orders_tenant_delete ON public.purchase_orders;
CREATE POLICY purchase_orders_tenant_delete ON public.purchase_orders FOR DELETE
  USING ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS purchase_order_items_tenant_insert ON public.purchase_order_items;
CREATE POLICY purchase_order_items_tenant_insert ON public.purchase_order_items FOR INSERT
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS purchase_order_items_tenant_update ON public.purchase_order_items;
CREATE POLICY purchase_order_items_tenant_update ON public.purchase_order_items FOR UPDATE
  USING ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())))
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS purchase_order_items_tenant_delete ON public.purchase_order_items;
CREATE POLICY purchase_order_items_tenant_delete ON public.purchase_order_items FOR DELETE
  USING ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS stock_transfers_tenant_insert ON public.stock_transfers;
CREATE POLICY stock_transfers_tenant_insert ON public.stock_transfers FOR INSERT
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS stock_transfers_tenant_update ON public.stock_transfers;
CREATE POLICY stock_transfers_tenant_update ON public.stock_transfers FOR UPDATE
  USING ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())))
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS stock_transfers_tenant_delete ON public.stock_transfers;
CREATE POLICY stock_transfers_tenant_delete ON public.stock_transfers FOR DELETE
  USING ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS stock_transfer_items_tenant_insert ON public.stock_transfer_items;
CREATE POLICY stock_transfer_items_tenant_insert ON public.stock_transfer_items FOR INSERT
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS stock_transfer_items_tenant_update ON public.stock_transfer_items;
CREATE POLICY stock_transfer_items_tenant_update ON public.stock_transfer_items FOR UPDATE
  USING ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())))
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS stock_transfer_items_tenant_delete ON public.stock_transfer_items;
CREATE POLICY stock_transfer_items_tenant_delete ON public.stock_transfer_items FOR DELETE
  USING ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS sales_return_items_tenant_insert ON public.sales_return_items;
CREATE POLICY sales_return_items_tenant_insert ON public.sales_return_items FOR INSERT
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS sales_return_items_tenant_update ON public.sales_return_items;
CREATE POLICY sales_return_items_tenant_update ON public.sales_return_items FOR UPDATE
  USING ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())))
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS sales_return_items_tenant_delete ON public.sales_return_items;
CREATE POLICY sales_return_items_tenant_delete ON public.sales_return_items FOR DELETE
  USING ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS shifts_tenant_insert ON public.shifts;
CREATE POLICY shifts_tenant_insert ON public.shifts FOR INSERT
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));

DROP POLICY IF EXISTS shift_entries_tenant_insert ON public.shift_entries;
CREATE POLICY shift_entries_tenant_insert ON public.shift_entries FOR INSERT
  WITH CHECK ((app_is_super_admin() OR (tenant_id = app_current_tenant_id())));
