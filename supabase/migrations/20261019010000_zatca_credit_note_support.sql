-- =============================================================================
--  seen-ai-assistant-zatca-cr-task.md, ZATCA #1: credit notes (sales_returns)
--  gain the exact same ZATCA tracking shape tax_invoices already has
--  (20261003000000_zatca_real_submission_status.sql), plus their own PIH
--  chain claim -- a credit note is a real ZATCA document and must take its
--  own sequential link in the SAME tenant-wide hash chain invoices use
--  (zatca_invoice_chain_state, 20260917000000_zatca_invoice_hash_chain.sql),
--  not a separate chain of its own.
-- =============================================================================

ALTER TABLE public.sales_returns
  ADD COLUMN IF NOT EXISTS zatca_status TEXT NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS zatca_response JSONB,
  ADD COLUMN IF NOT EXISTS zatca_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_hash TEXT,
  ADD COLUMN IF NOT EXISTS previous_invoice_hash TEXT;

ALTER TABLE public.sales_returns
  DROP CONSTRAINT IF EXISTS sales_returns_zatca_status_check;
ALTER TABLE public.sales_returns
  ADD CONSTRAINT sales_returns_zatca_status_check
  CHECK (zatca_status IN ('not_applicable', 'pending', 'cleared', 'reported', 'rejected'));

-- Same anti-fork shape as uq_tax_invoices_pih_chain, but credit notes and
-- invoices share ONE chain per tenant -- so this can only constrain
-- uniqueness of previous_invoice_hash within sales_returns itself, not
-- across both tables. The real cross-table guarantee (that only one
-- document total -- invoice or note -- can ever claim a given previous hash)
-- is enforced procedurally: both create_pos_sale and
-- zatca_claim_credit_note_pih below take the SAME row lock on
-- zatca_invoice_chain_state before reading/advancing the tip, so the two
-- can never race each other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_returns_pih_chain
  ON public.sales_returns (tenant_id, previous_invoice_hash)
  WHERE previous_invoice_hash IS NOT NULL;

-- Mirrors create_pos_sale's own placeholder-hash computation
-- (20260917000000_zatca_invoice_hash_chain.sql) exactly, for a credit note
-- instead of a new sale. Idempotent: a note that already has invoice_hash
-- set just returns it again rather than re-claiming a second chain link for
-- the same note (a retried/duplicate call from server.ts must not corrupt
-- the chain).
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
    digest(
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
-- service_role only -- called exclusively from server.ts via supabaseAdmin, same as zatca_advance_chain_with_real_hash.
