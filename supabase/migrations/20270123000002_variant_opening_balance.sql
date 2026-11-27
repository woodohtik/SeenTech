-- seen-product-variants-barcode-po-price-task.md, phase 3: an opening balance
-- per variant. Before, a product with variants got its opening balance on
-- the product only and every variant started at zero -- the POS sold a
-- variant with nothing in stock and the totals did not match.
--
-- record_opening_balance is redefined from its snapshot
-- (supabase/schema/functions/record_opening_balance.sql) with one optional
-- argument, p_variant_id:
--   * with it, the movement goes on that variant's stock row; the product's
--     opening_balance is the sum of its variants'; once per variant
--     (operation 'opening_balance:<item>:<variant>');
--   * without it, exactly as before (once per product).
-- No line removed; the three-argument version is dropped because a default
-- argument would otherwise make two overloads that clash.
--
-- Test: supabase/tests/variant_opening_balance_test.sql
-- Rollback: supabase/rollbacks/20270123_variant_opening_balance.down.sql

DROP FUNCTION IF EXISTS public.record_opening_balance(uuid, uuid, numeric);

CREATE OR REPLACE FUNCTION public.record_opening_balance(p_item_id uuid, p_branch_id uuid, p_quantity numeric, p_variant_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_branch uuid := p_branch_id;
  v_op     text := 'opening_balance:' || p_item_id::text || COALESCE(':' || p_variant_id::text, '');
  v_result jsonb;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL OR NOT public.app_has_permission('inventory.create') THEN
    RAISE EXCEPTION 'لا تملك صلاحية إضافة رصيد افتتاحي' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.inventory_items WHERE id = p_item_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_variant_id IS NOT NULL THEN
    PERFORM 1 FROM public.inventory_variants WHERE id = p_variant_id AND item_id = p_item_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'سمة الصنف غير موجودة' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 1000000 THEN
    RAISE EXCEPTION 'الكمية الافتتاحية غير صالحة' USING ERRCODE = '22023';
  END IF;
  -- Once per item (or per variant): an opening balance is not a way to add stock later.
  IF EXISTS (SELECT 1 FROM public.stock_operations WHERE operation_id = v_op AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'الرصيد الافتتاحي لهذا الصنف مسجّل من قبل. للتعديل استخدم الجرد.' USING ERRCODE = '22023', HINT = 'opening_balance_exists';
  END IF;

  IF v_branch IS NULL THEN
    SELECT id INTO v_branch FROM public.branches WHERE tenant_id = v_tenant AND is_main = true LIMIT 1;
  END IF;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'المستودع الرئيسي غير موجود' USING ERRCODE = '22023';
  END IF;

  v_result := public.apply_stock_movement(v_op, v_branch, p_item_id, p_quantity, 'opening_balance', p_item_id, 'inventory_item', p_variant_id);
  IF p_variant_id IS NULL THEN
    UPDATE public.inventory_items SET opening_balance = p_quantity, updated_at = now() WHERE id = p_item_id;
  ELSE
    UPDATE public.inventory_items SET opening_balance = COALESCE(opening_balance, 0) + p_quantity, updated_at = now() WHERE id = p_item_id;
  END IF;
  RETURN v_result;
END $function$;

REVOKE ALL ON FUNCTION public.record_opening_balance(uuid, uuid, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_opening_balance(uuid, uuid, numeric, uuid) TO authenticated;
