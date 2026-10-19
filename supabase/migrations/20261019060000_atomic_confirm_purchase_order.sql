-- =============================================================================
--  مراجعة-الفريق-التقني-الكامل-2026-10-19.md (قاعدة بيانات، عالية -- الجزء
--  المتبقي من batch 4، 20261019040000_increment_supplier_balance_idempotency.sql):
--  تلك الدفعة أضافت idempotency لـincrement_supplier_balance فأغلقت خطر
--  مضاعفة رصيد المورد تحديداً، لكن handleConfirmOrder في PurchaseOrders.tsx
--  يبقى 3 طلبات شبكة منفصلة (خصم/إضافة مخزون لكل بند، تحديث رصيد المورد،
--  تحديث حالة السند) بلا معاملة واحدة تجمعها -- انقطاع الاتصال بين أي
--  خطوتين يترك حالة جزئية مرئية: مخزون ورصيد مورد مُحدَّثان بالفعل، لكن
--  السند نفسه لا يزال "مسودة" ويظهر قابلاً لإعادة التأكيد من أي جهاز آخر.
--
--  هذا يجمع الخطوات الثلاث في RPC واحد ذرّي (معاملة Postgres واحدة) --
--  بنفس مفاتيح idempotency المستخدَمة فعلياً اليوم من جانب العميل تماماً
--  (po:<order_id>:item:<item_id> لحركة كل بند، و<order_id> نفسه كمعرّف عملية
--  رصيد المورد وكمعرّف سطر supplier_transactions) حتى تُستأنف بأمان أي عملية
--  تأكيد قديمة بالنمط السابق (3 طلبات منفصلة) انقطعت منتصف الطريق، دون
--  تكرار أي أثر سبق تطبيقه فعلياً. حالة السند نفسها (received/returned) هي
--  مفتاح idempotency على مستوى العملية كلها.
--
--  PurchaseOrders.tsx's handleConfirmOrder is updated in the same batch to
--  call this single RPC instead of orchestrating the 3 separate calls.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.confirm_purchase_order(
  p_order_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
      p_operation_id   => 'po:' || p_order_id::text || ':item:' || v_item.item_id::text,
      p_branch_id      => v_branch_id,
      p_item_id        => v_item.item_id,
      p_delta          => v_item_delta,
      p_type           => CASE WHEN v_item_delta > 0 THEN 'addition' ELSE 'deduction' END,
      p_reference_id   => p_order_id,
      p_reference_type => v_order_type
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
END $$;

REVOKE ALL ON FUNCTION public.confirm_purchase_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_purchase_order(UUID) TO authenticated;
