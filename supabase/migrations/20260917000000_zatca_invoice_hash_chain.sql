-- =============================================================================
--  ZATCA Phase 2 readiness, Phase 3: server-computed invoice hash chain (PIH)
--  (seen-zatca-readiness-task.md)
--
--  ZATCA's e-invoicing spec requires every invoice to carry the hash of the
--  invoice immediately before it in that taxpayer's sequence (the "Previous
--  Invoice Hash", PIH) -- an unbroken, tamper-evident chain. This must be
--  computed and enforced server-side: a client-computed hash could simply be
--  faked by a compromised or modified device, defeating the entire point.
--
--  IMPORTANT -- what this migration deliberately does NOT do yet: ZATCA's
--  real PIH is Base64(SHA-256) of the full canonicalized UBL invoice XML
--  document. This system does not generate that XML yet (that's Phase 2 of
--  the task, which is itself blocked on Phase 1 -- the tenant's own real
--  ZATCA Compliance/Production CSID, which requires the business owner to
--  actually complete ZATCA's onboarding; there is no code path to fake a
--  real certificate). Hashing a placeholder canonical string of this
--  invoice's own key fields instead means the CHAIN MECHANICS -- server-
--  computed, strictly sequential, tamper-evident, one unbroken link per
--  tenant -- are correctly built and testable right now. Once Phase 2's
--  real XML generation exists, only the hash INPUT (right below
--  v_invoice_hash's computation) needs to change to hash that XML instead;
--  the chain-state table, locking, and anti-fork constraints below do not.
-- =============================================================================

-- One row per tenant: the tip of that tenant's own hash chain. Locked with
-- SELECT ... FOR UPDATE inside create_pos_sale below so two concurrent
-- sales for the same tenant (two POS terminals ringing up sales at the same
-- moment) can never both compute their hash from the same parent -- the
-- second transaction blocks until the first commits and sees the real,
-- updated tip.
CREATE TABLE IF NOT EXISTS public.zatca_invoice_chain_state (
  tenant_id          UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  last_invoice_hash  TEXT,
  last_invoice_id    UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.zatca_invoice_chain_state ENABLE ROW LEVEL SECURITY;
-- No policies at all, deliberately: this table is bookkeeping for a
-- SECURITY DEFINER function only, never read or written directly by a
-- client. RLS with zero policies means only service_role (which bypasses
-- RLS) can touch it outside that function.

ALTER TABLE public.tax_invoices
  ADD COLUMN IF NOT EXISTS invoice_hash          TEXT,
  ADD COLUMN IF NOT EXISTS previous_invoice_hash TEXT;

-- Anti-fork constraints: no two invoices for the same tenant may claim the
-- same previous-hash (that would mean the chain split into two branches),
-- and at most one invoice per tenant may have no previous hash at all (the
-- genuine first link). Partial indexes because plain UNIQUE would let
-- multiple NULLs through untouched -- exactly the first-invoice case that
-- needs its own, separate uniqueness rule.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_invoices_pih_chain
  ON public.tax_invoices (tenant_id, previous_invoice_hash)
  WHERE previous_invoice_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_invoices_pih_first_link
  ON public.tax_invoices (tenant_id)
  WHERE previous_invoice_hash IS NULL AND invoice_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_pos_sale(
  p_operation_id UUID,
  p_order        JSONB,
  p_items        JSONB,
  p_invoice      JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant         uuid;
  v_staff          uuid;
  v_staff_name     text;
  v_branch         uuid;
  v_order_id       uuid := p_operation_id;
  v_op_key         text;
  v_existing       jsonb;
  v_item           jsonb;
  v_item_id        uuid;
  v_conflicts      int := 0;
  v_prev_hash      text;
  v_invoice_hash   text;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id مطلوب لمنع تكرار البيع' USING ERRCODE = '22023';
  END IF;

  v_tenant := public.app_current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_op_key := 'pos_sale:' || p_operation_id::text;

  SELECT result INTO v_existing
    FROM public.stock_operations
   WHERE operation_id = v_op_key AND tenant_id = v_tenant;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing || jsonb_build_object('replayed', true);
  END IF;

  v_staff := public.app_current_staff_id();
  SELECT name INTO v_staff_name FROM public.staff WHERE id = v_staff;
  v_branch := NULLIF(p_order->>'branch_id', '')::uuid;

  INSERT INTO public.orders (
    id, tenant_id, branch_id, shift_id, customer_id, customer_name,
    order_number, status, payment_method, total_amount, paid_amount,
    tax_rate, tax_amount, discount_amount, order_date, delivery_date,
    qr_code, notes, created_by, created_at
  ) VALUES (
    v_order_id, v_tenant, v_branch,
    NULLIF(p_order->>'shift_id', '')::uuid,
    NULLIF(p_order->>'customer_id', '')::uuid,
    p_order->>'customer_name',
    (p_order->>'order_number')::bigint,
    (p_order->>'status')::order_status,
    (p_order->>'payment_method')::payment_method,
    (p_order->>'total_amount')::numeric,
    (p_order->>'paid_amount')::numeric,
    (p_order->>'tax_rate')::numeric,
    (p_order->>'tax_amount')::numeric,
    (p_order->>'discount_amount')::numeric,
    (p_order->>'order_date')::timestamptz,
    (p_order->>'delivery_date')::timestamptz,
    p_order->>'qr_code',
    p_order->>'notes',
    v_staff,
    (p_order->>'order_date')::timestamptz
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO public.order_items (
      tenant_id, order_id, type, status, item_id, name, garment_type, fabric,
      fabric_id, quantity, selected_unit, consumed_meters, price,
      closure_type, closure_visibility, collar_type, cuff_type, pocket_type,
      chest_style, collar_padding, additions, embroidery, measurements
    ) VALUES (
      v_tenant, v_order_id,
      (v_item->>'type')::order_item_type,
      NULLIF(v_item->>'status', '')::order_status,
      NULLIF(v_item->>'item_id', '')::uuid,
      v_item->>'name', v_item->>'garment_type', v_item->>'fabric',
      NULLIF(v_item->>'fabric_id', '')::uuid,
      (v_item->>'quantity')::numeric,
      NULLIF(v_item->>'selected_unit', '')::inventory_unit,
      NULLIF(v_item->>'consumed_meters', '')::numeric,
      (v_item->>'price')::numeric,
      NULLIF(v_item->>'closure_type', '')::closure_type,
      NULLIF(v_item->>'closure_visibility', '')::closure_visibility,
      v_item->>'collar_type', v_item->>'cuff_type', v_item->>'pocket_type',
      v_item->>'chest_style',
      NULLIF(v_item->>'collar_padding', '')::collar_padding,
      v_item->>'additions', v_item->>'embroidery',
      COALESCE(v_item->'measurements', '{}'::jsonb)
    );
  END LOOP;

  INSERT INTO public.order_history (
    tenant_id, order_id, status, notes, updated_by_staff, updated_by_name, updated_at
  ) VALUES (
    v_tenant, v_order_id, (p_order->>'status')::order_status,
    'إنشاء الطلب عبر نقطة البيع', v_staff, COALESCE(v_staff_name, 'System'),
    (p_order->>'order_date')::timestamptz
  );

  -- PIH chain: lock (or create) this tenant's chain-tip row first so no
  -- concurrent sale for the same tenant can read the same parent hash.
  INSERT INTO public.zatca_invoice_chain_state (tenant_id)
  VALUES (v_tenant)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT last_invoice_hash INTO v_prev_hash
    FROM public.zatca_invoice_chain_state
   WHERE tenant_id = v_tenant
   FOR UPDATE;

  -- See the migration-level comment above: placeholder hash input over this
  -- invoice's own fields, chained to the previous hash, until Phase 2's
  -- real XML generation exists.
  v_invoice_hash := encode(
    digest(
      COALESCE(v_prev_hash, '') || '|' || v_tenant::text || '|' ||
      (p_invoice->>'invoice_number') || '|' || (p_order->>'total_amount') || '|' ||
      (p_order->>'tax_amount') || '|' || (p_order->>'order_date'),
      'sha256'
    ),
    'base64'
  );

  UPDATE public.zatca_invoice_chain_state
     SET last_invoice_hash = v_invoice_hash, last_invoice_id = v_order_id, updated_at = now()
   WHERE tenant_id = v_tenant;

  INSERT INTO public.tax_invoices (
    tenant_id, order_id, invoice_number, customer_id, customer_name,
    subtotal, tax_rate, tax_amount, discount_amount, paid_amount, total_amount,
    vat_number, qr_payload, issued_at, created_at, status, notes,
    invoice_hash, previous_invoice_hash
  ) VALUES (
    v_tenant, v_order_id, p_invoice->>'invoice_number',
    NULLIF(p_order->>'customer_id', '')::uuid, p_order->>'customer_name',
    (p_invoice->>'subtotal')::numeric, (p_order->>'tax_rate')::numeric,
    (p_order->>'tax_amount')::numeric, (p_order->>'discount_amount')::numeric,
    (p_order->>'paid_amount')::numeric, (p_order->>'total_amount')::numeric,
    NULLIF(p_invoice->>'vat_number', ''), p_order->>'qr_code',
    (p_order->>'order_date')::timestamptz, (p_order->>'order_date')::timestamptz,
    'issued', p_invoice->>'notes',
    v_invoice_hash, v_prev_hash
  );

  INSERT INTO public.employee_activity_logs (
    tenant_id, staff_id, staff_name, action, details, occurred_at
  ) VALUES (
    v_tenant, v_staff, COALESCE(v_staff_name, 'System'), 'create_invoice',
    'تم إنشاء فاتورة جديدة بقيمة ' || (p_order->>'total_amount') || ' للعميل ' || (p_order->>'customer_name'),
    now()
  );

  IF v_branch IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      IF (v_item->>'type') = 'ready_made' AND NULLIF(v_item->>'item_id', '') IS NOT NULL THEN
        v_item_id := (v_item->>'item_id')::uuid;
        BEGIN
          PERFORM public.apply_stock_movement(
            v_op_key || ':item:' || (v_item->>'item_id'),
            v_branch, v_item_id,
            -abs((v_item->>'quantity')::numeric), 'sale', v_order_id, 'pos_sale'
          );
        EXCEPTION WHEN OTHERS THEN
          v_conflicts := v_conflicts + 1;
          UPDATE public.order_items
             SET stock_conflict = true, stock_conflict_reason = SQLERRM
           WHERE order_id = v_order_id AND item_id = v_item_id AND tenant_id = v_tenant;
        END;
      ELSIF (v_item->>'type') = 'custom'
            AND NULLIF(v_item->>'fabric_id', '') IS NOT NULL
            AND (v_item->>'fabric_id') <> 'custom'
            AND NULLIF(v_item->>'consumed_meters', '') IS NOT NULL THEN
        v_item_id := (v_item->>'fabric_id')::uuid;
        BEGIN
          PERFORM public.apply_stock_movement(
            v_op_key || ':fabric:' || (v_item->>'fabric_id'),
            v_branch, v_item_id,
            -abs((v_item->>'consumed_meters')::numeric), 'sale', v_order_id, 'pos_sale'
          );
        EXCEPTION WHEN OTHERS THEN
          v_conflicts := v_conflicts + 1;
          UPDATE public.order_items
             SET stock_conflict = true, stock_conflict_reason = SQLERRM
           WHERE order_id = v_order_id AND fabric_id = v_item_id AND tenant_id = v_tenant;
        END;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.stock_operations (operation_id, tenant_id, kind, result)
  VALUES (v_op_key, v_tenant, 'pos_sale',
          jsonb_build_object('order_id', v_order_id, 'stock_conflicts', v_conflicts));

  RETURN jsonb_build_object('order_id', v_order_id, 'stock_conflicts', v_conflicts, 'replayed', false);
END $$;

REVOKE EXECUTE ON FUNCTION public.create_pos_sale(UUID,JSONB,JSONB,JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_pos_sale(UUID,JSONB,JSONB,JSONB) TO authenticated;
