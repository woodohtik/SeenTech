-- seen-readiness-fixes-task.md P4 (OPERATIONS-09) -- short fabric at the
-- cutting stage no longer stops the order with no way forward.
--
-- Before: moving an order to the stage that uses its cloth failed when the
-- system's stock was short (often only because a delivery was never
-- entered), and the only way through was writing the stock down to zero.
--
-- Now:
--  * the refusal names the fabric, the metres needed and the metres there
--    (hint fabric_shortage), so the screen can offer what to do;
--  * continue_with_fabric_shortage (inventory.reconcile, with a reason) moves
--    the order anyway: what is in stock is deducted, the rest is kept in
--    fabric_shortages (open until someone settles it) and the order's history
--    says so.
-- Rollback: supabase/rollbacks/20270105_fabric_shortage.down.sql

CREATE TABLE IF NOT EXISTS public.fabric_shortages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id    uuid        NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  fabric_id   uuid        NOT NULL,
  branch_id   uuid,
  needed      numeric     NOT NULL,
  deducted    numeric     NOT NULL DEFAULT 0,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_fabric_shortages_open ON public.fabric_shortages (tenant_id) WHERE resolved_at IS NULL;
ALTER TABLE public.fabric_shortages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fabric_shortages_read ON public.fabric_shortages;
CREATE POLICY fabric_shortages_read ON public.fabric_shortages FOR SELECT TO authenticated
  USING (tenant_id = app_current_tenant_id() AND app_has_permission('inventory.view'::text));
REVOKE INSERT, UPDATE, DELETE ON public.fabric_shortages FROM anon, authenticated;

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
  v_have      numeric;
  v_take      numeric;
  v_name      text;
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

    -- seen-readiness-fixes-task.md P4 (OPERATIONS-09): short stock says what
    -- is short. Someone allowed to reconcile stock may go on anyway
    -- (continue_with_fabric_shortage): what is there is deducted and the rest
    -- is kept as a pending shortage, in fabric_shortages.
    SELECT COALESCE(SUM(quantity), 0) INTO v_have FROM public.branch_inventory
     WHERE tenant_id = v_tenant AND branch_id = v_branch AND item_id = v_line.fabric_id AND variant_id IS NULL;
    IF v_have < abs(v_line.meters) THEN
      SELECT name INTO v_name FROM public.inventory_items WHERE id = v_line.fabric_id;
      IF current_setting('seen.allow_fabric_shortage', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'القماش «%» غير كافٍ: المطلوب % م والمتاح % م', COALESCE(v_name, ''), abs(v_line.meters), GREATEST(v_have, 0)
          USING ERRCODE = '23514', HINT = 'fabric_shortage';
      END IF;
      v_take := GREATEST(v_have, 0);
      INSERT INTO public.fabric_shortages (tenant_id, order_id, fabric_id, branch_id, needed, deducted, created_by)
      VALUES (v_tenant, p_order_id, v_line.fabric_id, v_branch, abs(v_line.meters), v_take, public.app_actor_staff_id());
    ELSE
      v_take := abs(v_line.meters);
    END IF;

    IF v_take > 0 THEN
      PERFORM public.apply_stock_movement(
        'order:' || p_order_id::text || ':line:' || v_line.line_key,
        v_branch, v_line.fabric_id, -v_take, 'deduction', p_order_id, 'order'
      );
    END IF;
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


CREATE OR REPLACE FUNCTION public.continue_with_fabric_shortage(
  p_order_id uuid, p_status text, p_status_key text, p_notes text, p_op_id uuid,
  p_history_note text, p_fabric_lines jsonb, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_note   text;
  v_result jsonb;
BEGIN
  IF public.app_current_tenant_id() IS NULL OR NOT public.app_has_permission('inventory.reconcile') THEN
    RAISE EXCEPTION 'المتابعة رغم نقص القماش تحتاج صلاحية تسوية المخزون' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'اكتب سبب المتابعة رغم نقص القماش' USING ERRCODE = '22023';
  END IF;
  v_note := concat_ws(' — ', NULLIF(p_history_note, ''), 'تابع رغم نقص القماش: ' || v_reason);
  PERFORM set_config('seen.allow_fabric_shortage', 'on', true);
  IF p_fabric_lines IS NOT NULL THEN
    v_result := to_jsonb(public.update_order_status_with_fabric(p_order_id, p_status, p_status_key, p_fabric_lines, p_notes, p_op_id, v_note));
  ELSE
    v_result := to_jsonb(public.update_order_status(p_order_id, p_status, p_status_key, p_notes, p_op_id, v_note));
  END IF;
  PERFORM set_config('seen.allow_fabric_shortage', 'off', true);
  RETURN jsonb_build_object('result', v_result,
    'open_shortages', (SELECT count(*) FROM public.fabric_shortages WHERE order_id = p_order_id AND resolved_at IS NULL));
END;
$function$;
REVOKE ALL ON FUNCTION public.continue_with_fabric_shortage(uuid, text, text, text, uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.continue_with_fabric_shortage(uuid, text, text, text, uuid, text, jsonb, text) TO authenticated;
