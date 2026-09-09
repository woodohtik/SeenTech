-- =============================================================================
--  إعادة توثيق INVENTORY_FIX.sql (جذر المستودع) ضمن سجل الـmigrations الفعلي
--  (seen-master-backlog-and-structure.md، خطوة 3: تحقّق قبل نقل ملفات SQL
--  المستقلة إلى supabase/legacy-setup/)
--  ------------------------------------------------------------------------
--  فحص مباشر: apply_stock_movement/record_uom_conversion/transfer_ship_item/
--  transfer_receive_item/stock_operations/app_current_staff_id -- كلها بنية
--  تحتية حيّة وحرِجة (اعتمدت عليها كل إصلاحات المخزون في هذه الجلسة) --
--  غير موجودة في أي ملف تحت supabase/migrations/ إطلاقاً. المنطق كان يعيش
--  فقط في INVENTORY_FIX.sql بجذر المستودع، خارج نظام التتبّع تماماً. هذا
--  الملف ينسخ نفس المنطق (قسم إصلاح الفساد التشخيصي في نهاية الملف الأصلي
--  استُبعِد عمداً -- استعلامات SELECT يدوية لمراجعة تاريخية، لا جزء من
--  المخطط) ليصبح جزءاً حقيقياً من تاريخ الهجرات.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.app_current_staff_id()
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s uuid; cur text;
BEGIN
  cur := public.app_current_uid();
  IF cur IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO s FROM public.staff
   WHERE uid = cur AND status = 'active'
   LIMIT 1;
  RETURN s;
END $$;

GRANT EXECUTE ON FUNCTION public.app_current_staff_id() TO authenticated;

CREATE TABLE IF NOT EXISTS public.stock_operations (
  operation_id TEXT PRIMARY KEY,
  tenant_id    UUID NOT NULL,
  kind         TEXT NOT NULL,
  result       JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_operations_tenant_created
  ON public.stock_operations (tenant_id, created_at DESC);

ALTER TABLE public.stock_operations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_operations_tenant ON public.stock_operations;
CREATE POLICY stock_operations_tenant ON public.stock_operations
  FOR ALL TO authenticated
  USING (public.app_is_super_admin() OR tenant_id = public.app_current_tenant_id())
  WITH CHECK (public.app_is_super_admin() OR tenant_id = public.app_current_tenant_id());

CREATE OR REPLACE FUNCTION public.apply_stock_movement(
  p_operation_id   TEXT,
  p_branch_id      UUID,
  p_item_id        UUID,
  p_delta          NUMERIC,
  p_type           TEXT,
  p_reference_id   UUID DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL
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

  v_staff := public.app_current_staff_id();

  SELECT quantity INTO v_prev
    FROM public.branch_inventory
   WHERE tenant_id = v_tenant
     AND branch_id = p_branch_id
     AND item_id   = p_item_id
     AND variant_id IS NULL
   FOR UPDATE;

  IF v_prev IS NULL THEN
    IF v_delta < 0 THEN
      RAISE EXCEPTION 'لا يوجد رصيد لهذا الصنف في هذا الفرع' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.branch_inventory (tenant_id, branch_id, item_id, quantity)
    VALUES (v_tenant, p_branch_id, p_item_id, 0)
    ON CONFLICT DO NOTHING;

    SELECT quantity INTO v_prev
      FROM public.branch_inventory
     WHERE tenant_id = v_tenant AND branch_id = p_branch_id
       AND item_id = p_item_id AND variant_id IS NULL
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
     AND item_id = p_item_id AND variant_id IS NULL;

  INSERT INTO public.stock_ledger (
    tenant_id, branch_id, item_id, type,
    previous_quantity, new_quantity, change,
    reference_id, reference_type, staff_id, staff_name
  )
  VALUES (
    v_tenant, p_branch_id, p_item_id, p_type::stock_movement_type,
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

REVOKE EXECUTE ON FUNCTION public.apply_stock_movement(TEXT,UUID,UUID,NUMERIC,TEXT,UUID,TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.apply_stock_movement(TEXT,UUID,UUID,NUMERIC,TEXT,UUID,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_uom_conversion(
  p_operation_id TEXT,
  p_branch_id    UUID,
  p_item_id      UUID,
  p_direction    TEXT,
  p_qty          NUMERIC,
  p_notes        TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant    uuid;
  v_staff     uuid;
  v_staffname text;
  v_rate      numeric;
  v_large     text;
  v_base      text;
  v_stock     numeric;
  v_required  numeric;
  v_result    numeric;
  v_existing  jsonb;
BEGIN
  IF p_operation_id IS NULL OR btrim(p_operation_id) = '' THEN
    RAISE EXCEPTION 'operation_id مطلوب' USING ERRCODE = '22023';
  END IF;
  IF p_direction NOT IN ('unroll', 'bundle') THEN
    RAISE EXCEPTION 'اتجاه التحويل غير صالح' USING ERRCODE = '22023';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'الكمية غير صالحة' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  IF COALESCE(public.app_current_role(), '') NOT IN ('owner','admin','manager','branch_manager','warehouse_manager','super_admin') THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تنفيذ عمليات تحويل الوحدات' USING ERRCODE = '42501';
  END IF;

  SELECT result INTO v_existing
    FROM public.stock_operations
   WHERE operation_id = p_operation_id AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  SELECT COALESCE(conversion_rate, 0), unit::text, COALESCE(base_unit::text, 'meter')
    INTO v_rate, v_large, v_base
    FROM public.inventory_items
   WHERE id = p_item_id AND tenant_id = v_tenant;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'الصنف غير موجود' USING ERRCODE = '23503';
  END IF;
  IF v_rate <= 0 THEN
    RAISE EXCEPTION 'معامل التحويل لهذا الصنف غير مضبوط — اضبطه من إعدادات الوحدات أولاً'
      USING ERRCODE = '22023';
  END IF;

  SELECT quantity INTO v_stock
    FROM public.branch_inventory
   WHERE tenant_id = v_tenant AND branch_id = p_branch_id
     AND item_id = p_item_id AND variant_id IS NULL
   FOR UPDATE;
  v_stock := COALESCE(v_stock, 0);

  IF p_direction = 'unroll' THEN
    v_required := round(p_qty * v_rate, 4);
    v_result   := v_required;
  ELSE
    v_required := round(p_qty, 4);
    v_result   := round(p_qty / v_rate, 4);
  END IF;

  IF v_required > v_stock THEN
    RAISE EXCEPTION 'الكمية المطلوبة للتحويل غير متوفرة (المتاح % ، المطلوب %)',
      v_stock, v_required USING ERRCODE = '23514';
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name INTO v_staffname FROM public.staff WHERE id = v_staff;

  INSERT INTO public.uom_conversion_logs (
    tenant_id, branch_id, item_id, staff_id, staff_name,
    from_unit, to_unit, converted_qty, resulting_qty, conversion_rate, notes
  ) VALUES (
    v_tenant::text, p_branch_id::text, p_item_id::text,
    COALESCE(v_staff::text, ''), COALESCE(v_staffname, ''),
    CASE WHEN p_direction = 'unroll' THEN v_large ELSE v_base END,
    CASE WHEN p_direction = 'unroll' THEN v_base  ELSE v_large END,
    round(p_qty, 4), v_result, v_rate, p_notes
  );

  INSERT INTO public.stock_ledger (
    tenant_id, branch_id, item_id, type,
    previous_quantity, new_quantity, change,
    reference_type, staff_id, staff_name
  ) VALUES (
    v_tenant, p_branch_id, p_item_id, 'adjustment',
    v_stock, v_stock, 0,
    'uom_conversion:' || p_direction, v_staff, v_staffname
  );

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (p_operation_id, v_tenant, 'uom_conversion',
          jsonb_build_object('direction', p_direction, 'consumed_base', v_required,
                             'resulting', v_result, 'rate', v_rate, 'stock', v_stock));

  RETURN jsonb_build_object(
    'direction', p_direction, 'consumed_base', v_required,
    'resulting', v_result, 'rate', v_rate, 'stock', v_stock, 'replayed', false
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.record_uom_conversion(TEXT,UUID,UUID,TEXT,NUMERIC,TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.record_uom_conversion(TEXT,UUID,UUID,TEXT,NUMERIC,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_ship_item(
  p_operation_id TEXT, p_transfer_id UUID, p_from_branch UUID,
  p_item_id UUID, p_qty NUMERIC
) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.apply_stock_movement(
    p_operation_id, p_from_branch, p_item_id, -abs(p_qty),
    'transfer_out', p_transfer_id, 'stock_transfer');
$$;

CREATE OR REPLACE FUNCTION public.transfer_receive_item(
  p_operation_id TEXT, p_transfer_id UUID, p_to_branch UUID,
  p_item_id UUID, p_qty NUMERIC
) RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.apply_stock_movement(
    p_operation_id, p_to_branch, p_item_id, abs(p_qty),
    'transfer_in', p_transfer_id, 'stock_transfer');
$$;

REVOKE EXECUTE ON FUNCTION public.transfer_ship_item(TEXT,UUID,UUID,UUID,NUMERIC)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transfer_receive_item(TEXT,UUID,UUID,UUID,NUMERIC) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.transfer_ship_item(TEXT,UUID,UUID,UUID,NUMERIC)    TO authenticated;
GRANT  EXECUTE ON FUNCTION public.transfer_receive_item(TEXT,UUID,UUID,UUID,NUMERIC) TO authenticated;

DO $$ BEGIN
  ALTER TABLE public.branch_inventory
    ADD CONSTRAINT chk_branch_inventory_non_negative CHECK (quantity >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN check_violation  THEN
    RAISE WARNING '[INVENTORY_FIX] يوجد رصيد سالب في branch_inventory';
END $$;

DO $$ BEGIN
  ALTER TABLE public.item_uom_conversions
    ADD CONSTRAINT chk_item_uom_rate_positive CHECK (conversion_rate > 0);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.stock_ledger
    ADD CONSTRAINT chk_stock_ledger_consistent
    CHECK (previous_quantity + change = new_quantity);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN check_violation  THEN
    RAISE WARNING '[INVENTORY_FIX] توجد قيود سجل غير متسقة';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fabric_uoms','item_uom_conversions','uom_conversion_logs'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON public.%I;', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON public.%I;', t, t);
    EXECUTE format($f$
      CREATE POLICY %I_tenant ON public.%I FOR ALL TO authenticated
        USING (public.app_is_super_admin() OR tenant_id = public.app_current_tenant_id()::text)
        WITH CHECK (public.app_is_super_admin() OR tenant_id = public.app_current_tenant_id()::text);
    $f$, t, t);
  END LOOP;
END $$;
