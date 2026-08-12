-- ============================================================================
--  INVENTORY_FIX.sql — طبقة حركة المخزون الآمنة
--  نظام سين — Seen POS
-- ----------------------------------------------------------------------------
--  يُنفَّذ في Supabase SQL Editor بعد SECURITY_FIX.sql.
--
--  يعالج ما يلي، ويستبدل الحساب الذي كان يجري في المتصفح:
--    • كل حركة مخزون تصبح فرقاً نسبياً (quantity = quantity + delta) داخل معاملة
--      واحدة مع قفل صف — فينتهي سباق الكتابة (lost update) الذي كان يمحو
--      عمليات البيع والتحويل عند تزامنها.
--    • شرط عدم السالب يُفرَض في قاعدة البيانات لا في الواجهة.
--    • قيد stock_ledger يُكتب في نفس المعاملة، وقيمه مشتقة من الصف الفعلي
--      قبل وبعد التغيير — فلا يمكن أن يختلف السجل عن المخزون.
--    • مفتاح منع التكرار (idempotency) يجعل النقر المزدوج أو إعادة المحاولة
--      بعد فشل جزئي بلا أثر مضاعف.
--    • staff_id يُشتقّ من الرمز المُتحقَّق منه — لا 'system' ولا '' ولا uid فايربيس.
--    • فكّ الطاقة / لفّ الأمتار = إعادة تغليف: صافي التغيّر صفر، مع التحقق من
--      كفاية الرصيد ومن الصلاحية.
--
--  الملف قابل لإعادة التشغيل (idempotent).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1) هوية الموظف الحالي — يصلح انهيار كل قيود السجل
--    stock_ledger.staff_id من نوع UUID يشير إلى staff(id)، وكان الكود يمرّر
--    'system' أو '' أو معرّف فايربيس النصّي، فيفشل الإدراج بـ 22P02 بعد أن
--    يكون المخزون قد تغيّر بالفعل.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.app_current_staff_id()
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s uuid; cur text;
BEGIN
  cur := public.app_current_uid();
  IF cur IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO s FROM public.staff
   WHERE uid = cur AND status = 'active'
   LIMIT 1;
  RETURN s;   -- NULL مقبول: العمود nullable ومرجعه ON DELETE SET NULL
END $$;

GRANT EXECUTE ON FUNCTION public.app_current_staff_id() TO authenticated;

-- ============================================================================
-- 2) سجل العمليات — منع التكرار
--    يُمرَّر operation_id يولّده المتصفح لكل ضغطة زر. إعادة إرسال نفس المعرّف
--    تُعيد النتيجة الأولى بدل تطبيق الحركة مرة أخرى.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.stock_operations (
  -- TEXT, not UUID: callers pass a deterministic key such as
  -- '<transfer_id>:<item_id>:ship', so a retry after a network failure or a second
  -- click on Ship replays the stored result instead of moving stock again.
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

-- ============================================================================
-- 3) الحركة الأساسية — كل تغيير في المخزون يمرّ من هنا
--
--    p_delta موجب = إدخال، سالب = إخراج.
--    ترجع { previous, new, change, operation_id, replayed }.
--
--    ملاحظة تصميم: لا نستخدم ON CONFLICT هنا عمداً. الفهرس الفريد على
--    branch_inventory تعبيري:
--        (branch_id, item_id, COALESCE(variant_id, '000...'))
--    و PostgreSQL لا يطابق ON CONFLICT (branch_id, item_id) مع فهرس تعبيري،
--    فكان الكود القديم يرفع 42P10. نستخدم UPDATE ... RETURNING (يأخذ قفل صف)
--    ثم INSERT عند غياب الصف.
-- ============================================================================
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

  -- إعادة تشغيل نفس العملية: أعد النتيجة الأصلية بلا أي أثر جديد
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

  -- اقفل الصف واقرأ الرصيد الحالي. القفل هنا هو ما يُسلسِل العمليات المتزامنة،
  -- والقراءة بعده تضمن أن رسالة «الكمية غير متوفرة» تسبق أي خطأ قيد من القاعدة.
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

  -- القيد مشتقّ من الصف الفعلي — لا يمكن أن يخالف المخزون
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

DROP FUNCTION IF EXISTS public.apply_stock_movement(UUID,UUID,UUID,NUMERIC,TEXT,UUID,TEXT,BOOLEAN);
DROP FUNCTION IF EXISTS public.apply_stock_movement(UUID,UUID,UUID,NUMERIC,TEXT,UUID,TEXT);
DROP FUNCTION IF EXISTS public.record_uom_conversion(UUID,UUID,UUID,TEXT,NUMERIC,TEXT);
DROP FUNCTION IF EXISTS public.transfer_ship_item(UUID,UUID,UUID,UUID,NUMERIC);
DROP FUNCTION IF EXISTS public.transfer_receive_item(UUID,UUID,UUID,UUID,NUMERIC);
REVOKE EXECUTE ON FUNCTION public.apply_stock_movement(TEXT,UUID,UUID,NUMERIC,TEXT,UUID,TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.apply_stock_movement(TEXT,UUID,UUID,NUMERIC,TEXT,UUID,TEXT) TO authenticated;

-- ============================================================================
-- 4) تحويل وحدات القماش — إعادة تغليف، صافي التغيّر صفر
--
--    فكّ طاقة (unroll): يستهلك p_qty × المعامل متراً من الرصيد ويعيدها أمتاراً
--    لفّ أمتار (bundle): يستهلك p_qty متراً ويعيدها طاقات
--    في الحالتين مجموع الأمتار لا يتغيّر — لذلك لا نلمس branch_inventory
--    إطلاقاً، ونكتفي بالتحقق من كفاية الرصيد وتسجيل العملية.
--
--    هذا يصحّح الخلل الذي كان يضيف p_qty × المعامل عند الفك (خلق قماش)
--    ويخصم p_qty × المعامل عند اللفّ (إتلاف 25 ضعف المعروض).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_uom_conversion(
  p_operation_id TEXT,
  p_branch_id    UUID,
  p_item_id      UUID,
  p_direction    TEXT,      -- 'unroll' | 'bundle'
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

  -- الصلاحية: التحويل عملية مخزنية، لا يفتحها مجرد فتح التبويب
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
  -- معامل صفري أو سالب كان يُعامَل في الواجهة كأنه 1، فيصبح «فك 4 طاقات» = 4 أمتار
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

  -- كم متراً تمسّه هذه العملية، وماذا ينتج عنها
  IF p_direction = 'unroll' THEN
    v_required := round(p_qty * v_rate, 4);   -- p_qty طاقات
    v_result   := v_required;                 -- تصبح أمتاراً
  ELSE
    v_required := round(p_qty, 4);            -- p_qty أمتار
    v_result   := round(p_qty / v_rate, 4);   -- تصبح طاقات
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

  -- قيد بأثر صفري: العملية مرئية في السجل دون أن تغيّر الرصيد
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

-- ============================================================================
-- 5) شحن واستلام التحويلات بين الفروع — بحركة واحدة لكل طرف
-- ============================================================================
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

-- ============================================================================
-- 6) قيود سلامة كان غيابها يسمح بالبيانات الفاسدة
-- ============================================================================

-- الرصيد لا يكون سالباً — شبكة أمان أخيرة خلف الدوال أعلاه
DO $$ BEGIN
  ALTER TABLE public.branch_inventory
    ADD CONSTRAINT chk_branch_inventory_non_negative CHECK (quantity >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN check_violation  THEN
    RAISE WARNING '[INVENTORY_FIX] يوجد رصيد سالب في branch_inventory — صحّحه ثم أعد تشغيل هذا القسم. استعلام الكشف في نهاية الملف.';
END $$;

-- معامل التحويل يجب أن يكون موجباً (inventory_items فيها الشرط أصلاً، وهذه كانت بلا شرط)
DO $$ BEGIN
  ALTER TABLE public.item_uom_conversions
    ADD CONSTRAINT chk_item_uom_rate_positive CHECK (conversion_rate > 0);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$;

-- قيد السجل يجب أن يتسق مع نفسه دائماً
DO $$ BEGIN
  ALTER TABLE public.stock_ledger
    ADD CONSTRAINT chk_stock_ledger_consistent
    CHECK (previous_quantity + change = new_quantity);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN check_violation  THEN
    RAISE WARNING '[INVENTORY_FIX] توجد قيود سجل غير متسقة — راجع استعلام الكشف في نهاية الملف قبل إضافة الشرط.';
END $$;

-- ============================================================================
-- 7) سياسات RLS لجداول الوحدات
--    كانت تعتمد على current_setting('app.current_tenant_id') وهو متغيّر جلسة
--    لا يضبطه التطبيق إطلاقاً (المتصفح يخاطب PostgREST مباشرة)، فكانت الجداول
--    الثلاثة تعمل فقط بفضل allow_all. وبعد إزالتها كانت ستتوقف تماماً.
--    ملاحظة: tenant_id هنا TEXT بينما هو UUID في بقية المخطط — نقارن بالنص.
-- ============================================================================
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
    RAISE NOTICE '[INVENTORY_FIX] % : سياسة العزل أُعيد بناؤها على هوية الـ JWT', t;
  END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- 8) استعلامات كشف الفساد القائم — شغّلها وراجع النتائج
-- ============================================================================

-- أ) قيود سجل تخالف نفسها (نتيجة الكتابة اليدوية للأرقام من المتصفح)
SELECT id, branch_id, item_id, type, previous_quantity, change, new_quantity,
       previous_quantity + change - new_quantity AS discrepancy, created_at
  FROM public.stock_ledger
 WHERE previous_quantity + change <> new_quantity
 ORDER BY created_at DESC
 LIMIT 200;

-- ب) أرصدة سالبة
SELECT bi.branch_id, bi.item_id, ii.name, bi.quantity
  FROM public.branch_inventory bi
  JOIN public.inventory_items ii ON ii.id = bi.item_id
 WHERE bi.quantity < 0
 ORDER BY bi.quantity;

-- ج) عمليات التحويل التي غيّرت الرصيد (كان يجب أن تكون صافي صفر)
--     هذه هي القيود التي أنشأتها النافذة المعطوبة — راجعها يدوياً وصحّح الأرصدة.
SELECT sl.*, ii.name, ii.conversion_rate
  FROM public.stock_ledger sl
  JOIN public.inventory_items ii ON ii.id = sl.item_id
 WHERE sl.type = 'adjustment'
   AND sl.change <> 0
   AND ii.conversion_rate > 1
   AND abs(sl.change) = abs(round(sl.change / ii.conversion_rate, 4) * ii.conversion_rate)
 ORDER BY sl.created_at DESC
 LIMIT 200;

-- د) أصناف بلا معامل تحويل صالح رغم أنها أقمشة
SELECT id, name, unit, base_unit, conversion_rate
  FROM public.inventory_items
 WHERE category = 'fabric' AND (conversion_rate IS NULL OR conversion_rate <= 0);
