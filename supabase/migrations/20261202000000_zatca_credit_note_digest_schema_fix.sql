-- seen-status-fix-regressions-task.md item 8: zatca_claim_credit_note_pih
-- (20261019010000) calls bare `digest(...)` -- pgcrypto's digest() lives
-- in the `extensions` schema in this project (same root cause already
-- fixed for gen_random_bytes elsewhere), and this function's
-- `SET search_path = public` means an unqualified call can't resolve it.
-- Every credit note ZATCA PIH-chain claim fails at runtime as a result --
-- confirmed by reading the function: this is its only digest() call, and
-- it has no exception handler around it, so zatca_claim_credit_note_pih
-- raises on every single call today. Fixed the same way
-- create_pos_sale/issue_tax_invoice_for_order already call it:
-- `extensions.digest(...)`.

CREATE OR REPLACE FUNCTION public.zatca_claim_credit_note_pih(
  p_tenant_id UUID,
  p_note_id   UUID
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prev_hash text;
  v_hash      text;
  v_note      record;
BEGIN
  SELECT * INTO v_note FROM public.sales_returns WHERE id = p_note_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit note not found for this tenant' USING ERRCODE = 'P0002';
  END IF;

  IF v_note.invoice_hash IS NOT NULL THEN
    RETURN v_note.invoice_hash;
  END IF;

  INSERT INTO public.zatca_invoice_chain_state (tenant_id)
  VALUES (p_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT last_invoice_hash INTO v_prev_hash
    FROM public.zatca_invoice_chain_state
   WHERE tenant_id = p_tenant_id
   FOR UPDATE;

  v_hash := encode(
    extensions.digest(
      COALESCE(v_prev_hash, '') || '|' || p_tenant_id::text || '|' ||
      v_note.return_number || '|' || v_note.refunded_amount::text || '|' ||
      v_note.returned_at::text,
      'sha256'
    ),
    'base64'
  );

  UPDATE public.zatca_invoice_chain_state
     SET last_invoice_hash = v_hash, last_invoice_id = p_note_id, updated_at = now()
   WHERE tenant_id = p_tenant_id;

  UPDATE public.sales_returns
     SET invoice_hash = v_hash, previous_invoice_hash = v_prev_hash
   WHERE id = p_note_id AND tenant_id = p_tenant_id;

  RETURN v_hash;
END $$;

REVOKE EXECUTE ON FUNCTION public.zatca_claim_credit_note_pih(UUID, UUID) FROM PUBLIC, anon, authenticated;
