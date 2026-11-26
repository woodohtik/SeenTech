-- seen-merchant-trial-test-2026-11-26.md, phase 3 item 5: purchase order
-- numbers were the browser's clock (PO-1795645685295) -- long, and not in
-- order. Each shop now counts its own: PO-0001, PO-0002 ...; a purchase
-- return counts on its own (RET-0001). Existing orders keep their numbers.
--
-- create_purchase_order is redefined from its snapshot
-- (supabase/schema/functions/create_purchase_order.sql); changes: the number
-- is the server's (next_document_number), and it is returned and kept with
-- the replay result. No line removed. Its missing permission check (an
-- earlier finding) is unchanged here -- a separate decision.
--
-- Test: supabase/tests/purchase_order_numbers_test.sql
-- Rollback: supabase/rollbacks/20270119_purchase_order_numbers.down.sql

CREATE TABLE IF NOT EXISTS public.document_counters (
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  doc_type   text NOT NULL,
  last_value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, doc_type)
);
-- Only the definer functions touch it.
ALTER TABLE public.document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_counters FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_counters FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.next_document_number(p_tenant uuid, p_type text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next bigint;
BEGIN
  INSERT INTO public.document_counters (tenant_id, doc_type, last_value)
  VALUES (p_tenant, p_type, 1)
  ON CONFLICT (tenant_id, doc_type) DO UPDATE SET last_value = public.document_counters.last_value + 1
  RETURNING last_value INTO v_next;
  RETURN v_next;
END $function$;
REVOKE ALL ON FUNCTION public.next_document_number(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_purchase_order(p_operation_id uuid, p_header jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    uuid;
  v_staff     uuid;
  v_po_id     uuid := p_operation_id;
  v_op_key    text;
  v_existing  jsonb;
  v_item      jsonb;
  v_total     numeric := 0;
  v_prefix    text;
  v_number    text;
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

  v_staff := public.app_current_staff_id();

  SELECT COALESCE(SUM((i->>'total')::numeric), 0) INTO v_total
    FROM jsonb_array_elements(p_items) i;

  -- The shop's own sequence (seen-merchant-trial-test-2026-11-26.md, phase 3
  -- item 5): PO-0001, PO-0002 ...; a purchase return (RET-) counts on its own.
  -- The number the browser sends is only read for which of the two it is.
  v_prefix := CASE WHEN upper(COALESCE(p_header->>'po_number', '')) LIKE 'RET%' THEN 'RET' ELSE 'PO' END;
  v_number := v_prefix || '-' || lpad(public.next_document_number(v_tenant, 'purchase_order:' || v_prefix)::text, 4, '0');

  INSERT INTO public.purchase_orders (
    id, tenant_id, branch_id, supplier_id, po_number, total_amount,
    paid_amount, status, order_date, notes, created_by, created_at, updated_at
  ) VALUES (
    v_po_id, v_tenant,
    NULLIF(p_header->>'branch_id', '')::uuid,
    (p_header->>'supplier_id')::uuid,
    v_number,
    v_total, 0, 'draft', now(),
    p_header->>'notes', v_staff, now(), now()
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.purchase_order_items (
      tenant_id, purchase_order_id, item_id, variant_id, name, quantity, unit,
      conversion_rate, base_quantity, price_per_unit, total
    ) VALUES (
      v_tenant, v_po_id,
      NULLIF(v_item->>'item_id', '')::uuid,
      NULLIF(v_item->>'variant_id', '')::uuid,
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
          jsonb_build_object('purchase_order_id', v_po_id, 'total_amount', v_total, 'po_number', v_number));

  RETURN jsonb_build_object('purchase_order_id', v_po_id, 'total_amount', v_total, 'po_number', v_number, 'replayed', false);
END $function$;
