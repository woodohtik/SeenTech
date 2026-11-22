-- seen-readiness-fixes-task.md P4 (OPERATIONS-02, OPERATIONS-10; SECURITY-07)
-- -- a stock transfer moves in one piece.
--
-- Before: the browser called transfer_ship_item / transfer_receive_item line
-- by line, then wrote the voucher's status itself. A failure half-way left a
-- half-shipped voucher; nothing checked the voucher's state or that more
-- was not received than was shipped; variants were not carried; a voucher
-- could not be rejected.
--
-- Now (inventory.transfer):
--  * ship_stock_transfer(transfer): a pending voucher's every line leaves the
--    source branch at its requested quantity, in one transaction -- one line
--    short of stock and nothing moves; the voucher is in transit;
--  * receive_stock_transfer(transfer, received, remarks): an in-transit
--    voucher's lines arrive (never more than shipped; a shortfall is kept on
--    the line and in the remarks); the voucher is completed;
--  * reject_stock_transfer(transfer, reason): pending -> rejected; in transit
--    -> cancelled, the shipped stock back in the source branch;
--  * a line may carry a variant (stock_transfer_items.variant_id);
--  * a repeated call (a dropped answer, a double tap) moves nothing twice.
-- The per-line functions are no longer callable from the browser.
-- Rollback: supabase/rollbacks/20270105_stock_transfers_atomic.down.sql

ALTER TABLE public.stock_transfer_items ADD COLUMN IF NOT EXISTS variant_id uuid;

CREATE OR REPLACE FUNCTION public.ship_stock_transfer(p_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.app_current_tenant_id();
  v_tr     record;
  v_line   record;
BEGIN
  IF v_tenant IS NULL OR NOT public.app_has_permission('inventory.transfer') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تحويل المخزون' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_tr FROM public.stock_transfers WHERE id = p_transfer_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_tr.status IN ('in_transit', 'completed') THEN
    RETURN jsonb_build_object('status', v_tr.status, 'replayed', true);
  END IF;
  IF v_tr.status NOT IN ('pending', 'draft') THEN
    RAISE EXCEPTION 'لا يُشحن سند حالته %', v_tr.status USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_transfer_items WHERE transfer_id = p_transfer_id) THEN
    RAISE EXCEPTION 'السند بلا أصناف' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = p_transfer_id ORDER BY created_at, id LOOP
    IF COALESCE(v_line.requested_quantity, 0) <= 0 THEN
      RAISE EXCEPTION 'كمية غير صالحة للصنف %', v_line.item_name USING ERRCODE = '22023';
    END IF;
    PERFORM public.apply_stock_movement(
      'transfer:' || p_transfer_id::text || ':' || v_line.id::text || ':ship', v_tr.from_branch_id, v_line.item_id,
      -abs(v_line.requested_quantity), 'transfer_out', p_transfer_id, 'stock_transfer', v_line.variant_id);
    UPDATE public.stock_transfer_items SET shipped_quantity = v_line.requested_quantity WHERE id = v_line.id;
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'in_transit', shipped_by = public.app_actor_staff_id(), shipped_at = now(), updated_at = now()
   WHERE id = p_transfer_id;
  RETURN jsonb_build_object('status', 'in_transit', 'replayed', false);
END;
$function$;

-- p_received: { line id or item id: quantity }; a line not named arrives in full.
CREATE OR REPLACE FUNCTION public.receive_stock_transfer(p_transfer_id uuid, p_received jsonb DEFAULT '{}'::jsonb, p_remarks text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant  uuid := public.app_current_tenant_id();
  v_tr      record;
  v_line    record;
  v_qty     numeric;
  v_short   text[] := '{}';
  v_given   jsonb := COALESCE(p_received, '{}'::jsonb);
BEGIN
  IF v_tenant IS NULL OR NOT public.app_has_permission('inventory.transfer') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تحويل المخزون' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_tr FROM public.stock_transfers WHERE id = p_transfer_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_tr.status = 'completed' THEN
    RETURN jsonb_build_object('status', 'completed', 'replayed', true);
  END IF;
  IF v_tr.status <> 'in_transit' THEN
    RAISE EXCEPTION 'يُستلم السند بعد شحنه فقط' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = p_transfer_id ORDER BY created_at, id LOOP
    v_qty := COALESCE(
      NULLIF(v_given->>v_line.id::text, '')::numeric,
      NULLIF(v_given->>v_line.item_id::text, '')::numeric,
      v_line.shipped_quantity, 0);
    IF v_qty < 0 OR v_qty > COALESCE(v_line.shipped_quantity, 0) THEN
      RAISE EXCEPTION 'المستلم من % (%) أكثر مما شُحن (%)', v_line.item_name, v_qty, COALESCE(v_line.shipped_quantity, 0)
        USING ERRCODE = '22023';
    END IF;
    IF v_qty > 0 THEN
      PERFORM public.apply_stock_movement(
        'transfer:' || p_transfer_id::text || ':' || v_line.id::text || ':receive', v_tr.to_branch_id, v_line.item_id,
        v_qty, 'transfer_in', p_transfer_id, 'stock_transfer', v_line.variant_id);
    END IF;
    IF v_qty < COALESCE(v_line.shipped_quantity, 0) THEN
      v_short := v_short || (COALESCE(v_line.item_name, 'صنف') || ': ' || v_qty::text || ' من ' || v_line.shipped_quantity::text);
    END IF;
    UPDATE public.stock_transfer_items SET received_quantity = v_qty WHERE id = v_line.id;
  END LOOP;

  UPDATE public.stock_transfers
     SET status = 'completed', received_by = public.app_actor_staff_id(), received_at = now(), updated_at = now(),
         remarks = NULLIF(concat_ws(' — ', NULLIF(btrim(COALESCE(p_remarks, '')), ''),
                                   CASE WHEN array_length(v_short, 1) > 0 THEN 'نقص في الاستلام: ' || array_to_string(v_short, '، ') END), '')
   WHERE id = p_transfer_id;
  RETURN jsonb_build_object('status', 'completed', 'short', to_jsonb(v_short), 'replayed', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_stock_transfer(p_transfer_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.app_current_tenant_id();
  v_tr     record;
  v_line   record;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_tenant IS NULL OR NOT public.app_has_permission('inventory.transfer') THEN
    RAISE EXCEPTION 'لا تملك صلاحية تحويل المخزون' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'اكتب سبب الرفض أو الإلغاء' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_tr FROM public.stock_transfers WHERE id = p_transfer_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_tr.status IN ('rejected', 'cancelled') THEN
    RETURN jsonb_build_object('status', v_tr.status, 'replayed', true);
  END IF;

  IF v_tr.status IN ('pending', 'draft') THEN
    UPDATE public.stock_transfers SET status = 'rejected', remarks = v_reason, updated_at = now() WHERE id = p_transfer_id;
    RETURN jsonb_build_object('status', 'rejected', 'replayed', false);
  END IF;
  IF v_tr.status = 'in_transit' THEN
    -- The shipped stock goes back where it came from.
    FOR v_line IN SELECT * FROM public.stock_transfer_items WHERE transfer_id = p_transfer_id LOOP
      IF COALESCE(v_line.shipped_quantity, 0) > 0 THEN
        PERFORM public.apply_stock_movement(
          'transfer:' || p_transfer_id::text || ':' || v_line.id::text || ':return', v_tr.from_branch_id, v_line.item_id,
          v_line.shipped_quantity, 'transfer_in', p_transfer_id, 'stock_transfer', v_line.variant_id);
      END IF;
    END LOOP;
    UPDATE public.stock_transfers SET status = 'cancelled', remarks = v_reason, updated_at = now() WHERE id = p_transfer_id;
    RETURN jsonb_build_object('status', 'cancelled', 'replayed', false);
  END IF;
  RAISE EXCEPTION 'لا يُرفض سند مكتمل' USING ERRCODE = '22023';
END;
$function$;

REVOKE ALL ON FUNCTION public.ship_stock_transfer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_stock_transfer(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_stock_transfer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ship_stock_transfer(uuid), public.receive_stock_transfer(uuid, jsonb, text),
  public.reject_stock_transfer(uuid, text) TO authenticated;

-- The per-line functions: no longer for the browser.
REVOKE EXECUTE ON FUNCTION public.transfer_ship_item(text, uuid, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transfer_receive_item(text, uuid, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
