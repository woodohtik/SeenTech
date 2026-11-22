-- Rollback of 20270105000007_fabric_shortage.sql (the shortages table is kept).
DROP FUNCTION IF EXISTS public.continue_with_fabric_shortage(uuid, text, text, text, uuid, text, jsonb, text);
CREATE OR REPLACE FUNCTION public.deduct_order_fabric(p_order_id uuid, p_lines jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    uuid;
  v_staff     uuid;
  v_branch    uuid;
  v_order_br  uuid;
  v_done      timestamptz;
  v_strategy  text;
  v_line      record;
  v_count     integer := 0;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT branch_id, fabric_deducted_at INTO v_order_br, v_done
    FROM public.orders
   WHERE id = p_order_id AND tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_done IS NOT NULL THEN
    RETURN 0;
  END IF;

  FOR v_line IN
    SELECT l.line_key, l.fabric_id, l.meters
      FROM (
        SELECT oi.id::text AS line_key, oi.fabric_id, COALESCE(oi.consumed_meters, 0) AS meters
          FROM public.order_items oi
         WHERE p_lines IS NULL
           AND oi.order_id = p_order_id AND oi.tenant_id = v_tenant
           AND oi.type = 'custom' AND oi.fabric_id IS NOT NULL
        UNION ALL
        SELECT x->>'line_key', NULLIF(x->>'fabric_id', '')::uuid,
               COALESCE(NULLIF(x->>'meters', '')::numeric, 0)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_lines) = 'array' THEN p_lines ELSE '[]'::jsonb END) x
      ) l
     WHERE l.fabric_id IS NOT NULL AND l.meters > 0
     -- A fixed order, so two orders drawing on the same cloths lock the stock
     -- rows the same way round and cannot deadlock each other.
     ORDER BY l.fabric_id, l.line_key
  LOOP
    IF v_line.line_key IS NULL OR btrim(v_line.line_key) = '' THEN
      RAISE EXCEPTION 'line_key مطلوب لكل سطر قماش' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.inventory_items WHERE id = v_line.fabric_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- Resolved on first need, so an order with nothing to deduct never fails
    -- for lack of a branch.
    IF v_branch IS NULL THEN
      SELECT inventory_strategy INTO v_strategy FROM public.tenants WHERE id = v_tenant;
      IF COALESCE(v_strategy, 'centralized') = 'centralized' THEN
        SELECT id INTO v_branch FROM public.branches
         WHERE tenant_id = v_tenant AND is_main = true LIMIT 1;
        IF v_branch IS NULL THEN
          RAISE EXCEPTION 'المستودع الرئيسي غير موجود' USING ERRCODE = '22023';
        END IF;
      ELSE
        v_staff := public.app_current_staff_id();
        v_branch := COALESCE(v_order_br, (SELECT branch_id FROM public.staff WHERE id = v_staff));
        IF v_branch IS NULL THEN
          RAISE EXCEPTION 'لم يُحدَّد فرع لخصم القماش' USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;

    PERFORM public.apply_stock_movement(
      'order:' || p_order_id::text || ':line:' || v_line.line_key,
      v_branch, v_line.fabric_id, -abs(v_line.meters), 'deduction', p_order_id, 'order'
    );
    v_count := v_count + 1;
  END LOOP;

  -- Only a real deduction closes the order to further ones. An order whose
  -- lines carried no figure yet stays open, so the figure can still be
  -- entered and deducted at a later stage.
  IF v_count > 0 THEN
    UPDATE public.orders SET fabric_deducted_at = now() WHERE id = p_order_id;
  END IF;
  RETURN v_count;
END $function$
;
