-- seen-merchant-trial-test-2026-11-26.md, phase 3 item 1: a shop with stock
-- on hand had to make a fake purchase order to enter it. A new item takes an
-- opening quantity, recorded as the stock movement "opening_balance", once
-- per item, in the given branch (the main one by default).
--
-- Test: supabase/tests/opening_balance_test.sql
-- Rollback: supabase/rollbacks/20270120_opening_balance.down.sql

CREATE OR REPLACE FUNCTION public.record_opening_balance(p_item_id uuid, p_branch_id uuid, p_quantity numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_branch uuid := p_branch_id;
  v_op     text := 'opening_balance:' || p_item_id::text;
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
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 1000000 THEN
    RAISE EXCEPTION 'الكمية الافتتاحية غير صالحة' USING ERRCODE = '22023';
  END IF;
  -- Once per item: an opening balance is not a way to add stock later.
  IF EXISTS (SELECT 1 FROM public.stock_operations WHERE operation_id = v_op AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'الرصيد الافتتاحي لهذا الصنف مسجّل من قبل. للتعديل استخدم الجرد.' USING ERRCODE = '22023', HINT = 'opening_balance_exists';
  END IF;

  IF v_branch IS NULL THEN
    SELECT id INTO v_branch FROM public.branches WHERE tenant_id = v_tenant AND is_main = true LIMIT 1;
  END IF;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'المستودع الرئيسي غير موجود' USING ERRCODE = '22023';
  END IF;

  v_result := public.apply_stock_movement(v_op, v_branch, p_item_id, p_quantity, 'opening_balance', p_item_id, 'inventory_item');
  UPDATE public.inventory_items SET opening_balance = p_quantity, updated_at = now() WHERE id = p_item_id;
  RETURN v_result;
END $function$;

REVOKE ALL ON FUNCTION public.record_opening_balance(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_opening_balance(uuid, uuid, numeric) TO authenticated;
