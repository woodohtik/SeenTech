-- seen-merchant-trial-test-2026-11-26.md, phase 2 item 2 (question 2's
-- default): buttons and other components of a garment were never taken from
-- stock with a tailoring order ("نوع الإغلاق: أزرار" and the balance stayed).
--
--   * garment_components: a garment type's default components, kept once by
--     the shop ("ثوب" -> 5 buttons), shown in the cutting dialog.
--   * update_order_status_with_components: takes the components from stock
--     and then moves the stage through update_order_status_with_fabric (or
--     update_order_status) -- one transaction, so short stock fails both --
--     and only once per order (orders.components_taken_at).
--
-- update_order_status_with_fabric itself is not changed.
-- Test: supabase/tests/garment_components_test.sql
-- Rollback: supabase/rollbacks/20270117_garment_components.down.sql

CREATE TABLE IF NOT EXISTS public.garment_components (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  garment_type text NOT NULL CHECK (length(btrim(garment_type)) BETWEEN 1 AND 80),
  item_id      uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity     numeric NOT NULL CHECK (quantity > 0 AND quantity <= 1000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, garment_type, item_id)
);
CREATE INDEX IF NOT EXISTS garment_components_tenant_type_idx ON public.garment_components (tenant_id, garment_type);

ALTER TABLE public.garment_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.garment_components FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS garment_components_read ON public.garment_components;
CREATE POLICY garment_components_read ON public.garment_components FOR SELECT
  USING (app_is_super_admin() OR tenant_id = app_current_tenant_id());
-- Writing the defaults is editing the shop's stock setup (as inventory_items).
DROP POLICY IF EXISTS garment_components_insert ON public.garment_components;
CREATE POLICY garment_components_insert ON public.garment_components FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id() AND app_has_permission('inventory.edit')
              AND EXISTS (SELECT 1 FROM public.inventory_items i WHERE i.id = item_id AND i.tenant_id = garment_components.tenant_id));
DROP POLICY IF EXISTS garment_components_update ON public.garment_components;
CREATE POLICY garment_components_update ON public.garment_components FOR UPDATE
  USING (tenant_id = app_current_tenant_id() AND app_has_permission('inventory.edit'))
  WITH CHECK (tenant_id = app_current_tenant_id() AND app_has_permission('inventory.edit')
              AND EXISTS (SELECT 1 FROM public.inventory_items i WHERE i.id = item_id AND i.tenant_id = garment_components.tenant_id));
DROP POLICY IF EXISTS garment_components_delete ON public.garment_components;
CREATE POLICY garment_components_delete ON public.garment_components FOR DELETE
  USING (tenant_id = app_current_tenant_id() AND app_has_permission('inventory.edit'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.garment_components TO authenticated;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS components_taken_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS components_taken jsonb;

CREATE OR REPLACE FUNCTION public.update_order_status_with_components(
  p_order_id uuid, p_status text, p_status_key text, p_fabric_lines jsonb, p_components jsonb,
  p_notes text DEFAULT NULL, p_op_id uuid DEFAULT NULL, p_history_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    uuid;
  v_taken_at  timestamptz;
  v_order_br  uuid;
  v_branch    uuid;
  v_strategy  text;
  v_line      jsonb;
  v_item      uuid;
  v_qty       numeric;
  v_name      text;
  v_have      numeric;
  v_summary   text := '';
  v_note      text := p_history_note;
BEGIN
  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.app_has_permission('orders.update_status') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تعديل حالة الطلب' USING ERRCODE = '42501';
  END IF;

  SELECT components_taken_at, branch_id INTO v_taken_at, v_order_br
    FROM public.orders WHERE id = p_order_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_taken_at IS NULL AND jsonb_typeof(p_components) = 'array' AND jsonb_array_length(p_components) > 0
     AND p_status::order_status >= 'cutting'::order_status
     AND p_status::order_status <> 'cancelled'::order_status THEN

    -- The branch, as deduct_order_fabric resolves it.
    SELECT inventory_strategy INTO v_strategy FROM public.tenants WHERE id = v_tenant;
    IF COALESCE(v_strategy, 'centralized') = 'centralized' THEN
      SELECT id INTO v_branch FROM public.branches WHERE tenant_id = v_tenant AND is_main = true LIMIT 1;
    ELSE
      v_branch := COALESCE(v_order_br, (SELECT branch_id FROM public.staff WHERE id = public.app_current_staff_id()));
    END IF;
    IF v_branch IS NULL THEN
      RAISE EXCEPTION 'لم يُحدَّد فرع لخصم المكوّنات' USING ERRCODE = '22023';
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_components) LOOP
      BEGIN
        v_item := NULLIF(v_line->>'item_id', '')::uuid;
        v_qty := NULLIF(v_line->>'quantity', '')::numeric;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'مكوّن غير صالح' USING ERRCODE = '22023';
      END;
      IF v_qty IS NULL OR v_qty <= 0 THEN
        CONTINUE;  -- a component left at 0 for this order
      END IF;
      IF v_qty > 1000 THEN
        RAISE EXCEPTION 'كمية المكوّن أكبر من المسموح' USING ERRCODE = '22023';
      END IF;
      SELECT name INTO v_name FROM public.inventory_items WHERE id = v_item AND tenant_id = v_tenant;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'هذا المكوّن ليس من مخزون المحل. حدّث الصفحة ثم أعد المحاولة.' USING ERRCODE = '22023', HINT = 'component_unknown';
      END IF;
      SELECT COALESCE(SUM(quantity), 0) INTO v_have FROM public.branch_inventory
       WHERE tenant_id = v_tenant AND branch_id = v_branch AND item_id = v_item AND variant_id IS NULL;
      IF v_have < v_qty THEN
        RAISE EXCEPTION 'المكوّن «%» غير كافٍ: المطلوب % والمتاح %', COALESCE(v_name, ''), v_qty, GREATEST(v_have, 0)
          USING ERRCODE = '23514', HINT = 'component_shortage';
      END IF;
      PERFORM public.apply_stock_movement(
        'order:' || p_order_id::text || ':component:' || v_item::text,
        v_branch, v_item, -v_qty, 'deduction', p_order_id, 'order');
      v_summary := v_summary || CASE WHEN v_summary = '' THEN '' ELSE '، ' END || v_qty::text || ' ' || COALESCE(v_name, '');
    END LOOP;

    UPDATE public.orders SET components_taken_at = now(), components_taken = p_components WHERE id = p_order_id;
    IF v_summary <> '' THEN
      v_note := COALESCE(NULLIF(p_history_note, '') || ' | ', '') || 'المكوّنات عند القص: ' || v_summary;
    END IF;
  END IF;

  IF jsonb_typeof(p_fabric_lines) = 'array' THEN
    RETURN public.update_order_status_with_fabric(p_order_id, p_status, p_status_key, p_fabric_lines, p_notes, p_op_id, v_note);
  END IF;
  RETURN public.update_order_status(p_order_id, p_status, p_status_key, p_notes, p_op_id, v_note);
END $function$;

REVOKE ALL ON FUNCTION public.update_order_status_with_components(uuid, text, text, jsonb, jsonb, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_order_status_with_components(uuid, text, text, jsonb, jsonb, text, uuid, text) TO authenticated;
