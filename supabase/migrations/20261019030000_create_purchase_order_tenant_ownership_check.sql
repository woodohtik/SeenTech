-- =============================================================================
--  مراجعة-الفريق-التقني-الكامل-2026-10-19.md (قاعدة بيانات، عالية): create_purchase_order
--  هي SECURITY DEFINER (تتجاوز RLS) ولم تكن تتحقق أن supplier_id/branch_id
--  الممرَّرين من العميل ينتميان فعلاً للمستأجر الحالي قبل الإدراج -- بعكس
--  process_sales_return التي تتحقق صراحة من ملكية order_id. طلب بمعرّف
--  supplier_id ينتمي لمستأجر آخر كان يُقبَل بصمت وينشئ سند شراء لدى
--  المستأجر الحالي يشير لمورد لا يملك صلاحية قراءته (RLS تحجبه) -- فساد
--  بيانات صامت (سند شراء بلا اسم مورّد قابل للعرض).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_operation_id UUID,
  p_header       JSONB,
  p_items        JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant      uuid;
  v_staff       uuid;
  v_po_id       uuid := p_operation_id;
  v_op_key      text;
  v_existing    jsonb;
  v_item        jsonb;
  v_total       numeric := 0;
  v_supplier_id uuid;
  v_branch_id   uuid;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار إنشاء السند' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'create_po:' || p_operation_id::text;

  SELECT result INTO v_existing
    FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'لا يمكن إنشاء سند شراء بلا عناصر' USING ERRCODE = '22023';
  END IF;

  -- فحص ملكية المستأجر: SECURITY DEFINER يتجاوز RLS داخلياً، فهذا الفحص
  -- الصريح هو الضمان الوحيد ضد ربط سند الشراء بمورد/فرع تابع لمستأجر آخر.
  v_supplier_id := (p_header->>'supplier_id')::uuid;
  PERFORM 1 FROM public.suppliers WHERE id = v_supplier_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المورد غير موجود أو لا ينتمي لهذا المستأجر' USING ERRCODE = '42501';
  END IF;

  v_branch_id := NULLIF(p_header->>'branch_id', '')::uuid;
  IF v_branch_id IS NOT NULL THEN
    PERFORM 1 FROM public.branches WHERE id = v_branch_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الفرع غير موجود أو لا ينتمي لهذا المستأجر' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_staff := public.app_current_staff_id();

  SELECT COALESCE(SUM((i->>'total')::numeric), 0) INTO v_total
    FROM jsonb_array_elements(p_items) i;

  INSERT INTO public.purchase_orders (
    id, tenant_id, branch_id, supplier_id, po_number, total_amount,
    paid_amount, status, order_date, notes, created_by, created_at, updated_at
  ) VALUES (
    v_po_id, v_tenant, v_branch_id, v_supplier_id,
    p_header->>'po_number',
    v_total, 0, 'draft', now(),
    p_header->>'notes', v_staff, now(), now()
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.purchase_order_items (
      tenant_id, purchase_order_id, item_id, name, quantity, unit,
      conversion_rate, base_quantity, price_per_unit, total
    ) VALUES (
      v_tenant, v_po_id,
      NULLIF(v_item->>'item_id', '')::uuid,
      v_item->>'name',
      (v_item->>'quantity')::numeric,
      (v_item->>'unit')::inventory_unit,
      (v_item->>'conversion_rate')::numeric,
      (v_item->>'base_quantity')::numeric,
      (v_item->>'price_per_unit')::numeric,
      (v_item->>'total')::numeric
    );
  END LOOP;

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'create_purchase_order',
          jsonb_build_object('purchase_order_id', v_po_id, 'total_amount', v_total));

  RETURN jsonb_build_object('purchase_order_id', v_po_id, 'total_amount', v_total, 'replayed', false);
END $$;

REVOKE EXECUTE ON FUNCTION public.create_purchase_order(UUID,JSONB,JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_purchase_order(UUID,JSONB,JSONB) TO authenticated;
