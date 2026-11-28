-- seen-open-verticals-task.md, wave 1 (fabric stores item 3): remnants.
-- The end of a roll ("فضلة") becomes its own item -- one piece at its own
-- price, «بواقي: كتان أبيض — 1.2 م» -- and its metres leave the fabric's
-- stock in the same step (two ordinary stock movements: an adjustment out of
-- the fabric, an addition into the remnant). The remnant keeps where it came
-- from and how long it is, for the remnants list and its age.
--
-- Test: supabase/tests/remnants_test.sql
-- Rollback: supabase/rollbacks/20270124_remnants.down.sql

ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS remnant_of uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS remnant_meters numeric(10,2);
CREATE INDEX IF NOT EXISTS idx_inventory_items_remnants ON public.inventory_items (tenant_id, created_at) WHERE remnant_of IS NOT NULL;

CREATE OR REPLACE FUNCTION public.convert_to_remnant(p_item_id uuid, p_variant_id uuid, p_meters numeric, p_price numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant  uuid := public.app_current_tenant_id();
  v_item    record;
  v_branch  uuid;
  v_have    numeric;
  v_new_id  uuid := gen_random_uuid();
BEGIN
  IF v_tenant IS NULL OR NOT public.app_has_permission('inventory.create') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تحويل البواقي' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_item.base_unit::text, '') <> 'meter' THEN
    RAISE EXCEPTION 'البواقي للأقمشة اللي تنباع بالطول فقط' USING ERRCODE = '22023';
  END IF;
  IF p_meters IS NULL OR p_meters <= 0 OR p_price IS NULL OR p_price < 0 THEN
    RAISE EXCEPTION 'طول البواقي أو سعرها غير صالح' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(s.branch_id, b.id) INTO v_branch
    FROM (SELECT 1) one
    LEFT JOIN public.staff s ON s.id = public.app_current_staff_id()
    LEFT JOIN public.branches b ON b.tenant_id = v_tenant AND b.is_main;
  SELECT COALESCE(sum(quantity), 0) INTO v_have FROM public.branch_inventory
   WHERE tenant_id = v_tenant AND branch_id = v_branch AND item_id = p_item_id AND variant_id IS NOT DISTINCT FROM p_variant_id;
  IF v_have < p_meters THEN
    RAISE EXCEPTION 'المتوفر % م فقط', trim_scale(v_have) USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.inventory_items (id, tenant_id, name, category, category_key, unit, base_unit, conversion_rate, sku,
                                      price_per_unit, min_threshold, remnant_of, remnant_meters, supplier_id)
  VALUES (v_new_id, v_tenant, 'بواقي: ' || v_item.name || ' — ' || trim_scale(p_meters)::text || ' م',
          v_item.category, v_item.category_key, 'piece', 'piece', 1,
          'REM-' || upper(left(replace(v_new_id::text, '-', ''), 8)),
          p_price, 0, p_item_id, p_meters, v_item.supplier_id);

  PERFORM public.apply_stock_movement('remnant:' || v_new_id::text || ':out', v_branch, p_item_id, -p_meters, 'adjustment', v_new_id, 'remnant', p_variant_id);
  PERFORM public.apply_stock_movement('remnant:' || v_new_id::text || ':in', v_branch, v_new_id, 1, 'addition', p_item_id, 'remnant');

  RETURN jsonb_build_object('remnant_item_id', v_new_id, 'meters', p_meters, 'left_meters', v_have - p_meters);
END $function$;
REVOKE ALL ON FUNCTION public.convert_to_remnant(uuid, uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_to_remnant(uuid, uuid, numeric, numeric) TO authenticated;
