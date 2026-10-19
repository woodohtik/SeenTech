-- =============================================================================
--  مراجعة-الفريق-التقني-الكامل-2026-10-19.md (قاعدة بيانات، عالية):
--  increment_supplier_balance ذرّية حسابياً (UPDATE واحد بقفل صف ضمني) لكن
--  بلا أي مفتاح idempotency -- handleConfirmOrder في PurchaseOrders.tsx
--  (3 خطوات شبكية منفصلة بلا معاملة واحدة تجمعها) يستدعيها بعد خصم
--  المخزون؛ انقطاع اتصال بعد نجاح الاستدعاء وقبل تحديث حالة الطلب يترك
--  السند عالقاً، وإعادة محاولة الموظف تستدعي هذه الدالة من جديد فتُضاعِف
--  نفس الفرق على رصيد المورد مرتين. p_operation_id اختياري (NULL افتراضياً)
--  فلا يكسر أي استدعاء حالٍ -- caller جديد يمرّر معرّفاً ثابتاً لكل عملية
--  (نفس نمط stock_operations المستخدَم في create_pos_sale/
--  create_purchase_order) ليحصل على حماية التكرار.
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
  v_new       numeric;
  v_op_key    text;
  v_existing  jsonb;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
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
