-- seen-readiness-fixes-task.md P2.1 / P2.2 (ZATCA-03, ZATCA-07, ZATCA-08,
-- ZATCA-10, ZATCA-11, ZATCA-12, ZATCA-14) -- each tax document is fixed when
-- it is issued, and signed in order, once.
--
-- Before: the date, time and UUID were made up at the moment of sending (and
-- the UUID never kept), the lines were re-read from order_items (editable),
-- there was no invoice counter (ICV), and the hash chain (PIH) hung on a
-- placeholder hash; a credit note took a stale PIH before its place in the
-- chain was reserved.
--
-- Now:
--  * every tax_invoices / sales_returns row gets, as it is inserted, the
--    shop's next ICV (zatca_invoice_chain_state.last_icv, under the same row
--    lock the sale functions already take), its UUID, and a fixed copy of its
--    lines (`lines`): the order's lines as charged, or the credit note's
--    amount split by the original invoice's tax;
--  * the server signs a shop's documents strictly in ICV order
--    (zatca_signing_begin / _store / _end, one signer at a time per shop): PIH
--    = the previous document's real hash, ZATCA's fixed value for the first
--    one after the shop's production certificate; the signed XML, the hash
--    and the QR are kept, and that same XML is what is sent and resent;
--  * the Phase 1 QR has no line breaks (ZATCA-12);
--  * a credit note can no longer be edited or deleted from the browser
--    (ZATCA-14), like a tax invoice.
-- Documents issued before this migration have no ICV and stay outside the
-- chain (no shop has a production certificate yet).
-- Rollback: supabase/rollbacks/20270103_zatca_documents_at_issue.down.sql

ALTER TABLE public.zatca_invoice_chain_state
  ADD COLUMN IF NOT EXISTS last_icv        bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chain_start_icv bigint,
  ADD COLUMN IF NOT EXISTS last_signed_icv bigint,
  ADD COLUMN IF NOT EXISTS last_signed_hash text,
  ADD COLUMN IF NOT EXISTS signing_token   uuid,
  ADD COLUMN IF NOT EXISTS signing_until   timestamptz;

ALTER TABLE public.tax_invoices
  ADD COLUMN IF NOT EXISTS icv        bigint,
  ADD COLUMN IF NOT EXISTS zatca_uuid uuid,
  ADD COLUMN IF NOT EXISTS lines      jsonb,
  ADD COLUMN IF NOT EXISTS signed_xml text,
  ADD COLUMN IF NOT EXISTS zatca_qr   text,
  ADD COLUMN IF NOT EXISTS signed_at  timestamptz;
ALTER TABLE public.sales_returns
  ADD COLUMN IF NOT EXISTS icv        bigint,
  ADD COLUMN IF NOT EXISTS zatca_uuid uuid,
  ADD COLUMN IF NOT EXISTS lines      jsonb,
  ADD COLUMN IF NOT EXISTS signed_xml text,
  ADD COLUMN IF NOT EXISTS zatca_qr   text,
  ADD COLUMN IF NOT EXISTS signed_at  timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_invoices_tenant_icv ON public.tax_invoices (tenant_id, icv) WHERE icv IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_returns_tenant_icv ON public.sales_returns (tenant_id, icv) WHERE icv IS NOT NULL;

-- Stamp each new document -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.zatca_stamp_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inv   record;
  v_total numeric;
  v_tax   numeric;
BEGIN
  INSERT INTO public.zatca_invoice_chain_state (tenant_id) VALUES (NEW.tenant_id) ON CONFLICT (tenant_id) DO NOTHING;
  UPDATE public.zatca_invoice_chain_state
     SET last_icv = last_icv + 1, updated_at = now()
   WHERE tenant_id = NEW.tenant_id
  RETURNING last_icv INTO NEW.icv;
  NEW.zatca_uuid := COALESCE(NEW.zatca_uuid, gen_random_uuid());

  IF TG_TABLE_NAME = 'tax_invoices' THEN
    NEW.issued_at := COALESCE(NEW.issued_at, now());
    IF NEW.lines IS NULL AND NEW.order_id IS NOT NULL THEN
      SELECT jsonb_agg(jsonb_build_object(
               'name', COALESCE(NULLIF(oi.name, ''), NULLIF(oi.garment_type, ''), 'منتج'),
               'quantity', oi.quantity, 'unit', oi.selected_unit, 'price', oi.price,
               'tax_type', oi.tax_type, 'net', oi.line_net, 'tax', oi.line_tax)
             ORDER BY oi.created_at, oi.id)
        INTO NEW.lines
        FROM public.order_items oi
       WHERE oi.order_id = NEW.order_id AND oi.tenant_id = NEW.tenant_id;
    END IF;
  ELSE
    -- A credit note is an amount: split it the way the original invoice was taxed.
    SELECT total_amount, tax_amount, tax_rate INTO v_inv FROM public.tax_invoices WHERE id = NEW.invoice_id;
    v_total := COALESCE(NEW.total_amount, NEW.refunded_amount, 0);
    v_tax := CASE WHEN COALESCE(v_inv.total_amount, 0) > 0
                  THEN round(v_total * COALESCE(v_inv.tax_amount, 0) / v_inv.total_amount, 2) ELSE 0 END;
    NEW.lines := COALESCE(NEW.lines, jsonb_build_array(jsonb_build_object(
      'name', COALESCE(NULLIF(NEW.reason, ''), 'مرتجع'), 'quantity', 1,
      'tax_type', CASE WHEN v_tax > 0 THEN 'exclusive' ELSE 'exempt' END,
      'net', v_total - v_tax, 'tax', v_tax)));
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.zatca_stamp_document() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tax_invoices_zatca_stamp ON public.tax_invoices;
CREATE TRIGGER tax_invoices_zatca_stamp BEFORE INSERT ON public.tax_invoices
FOR EACH ROW EXECUTE FUNCTION public.zatca_stamp_document();
DROP TRIGGER IF EXISTS sales_returns_zatca_stamp ON public.sales_returns;
CREATE TRIGGER sales_returns_zatca_stamp BEFORE INSERT ON public.sales_returns
FOR EACH ROW WHEN (NEW.invoice_id IS NOT NULL) EXECUTE FUNCTION public.zatca_stamp_document();

-- Signing, in ICV order, one signer per shop (server only) ---------------------
CREATE OR REPLACE FUNCTION public.zatca_first_pih()
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT translate(encode(convert_to(encode(sha256('0'::bytea), 'hex'), 'UTF8'), 'base64'), E'\n\r', '') $$;

CREATE OR REPLACE FUNCTION public.zatca_unsigned_documents(p_tenant uuid, p_after bigint)
RETURNS TABLE (kind text, id uuid, icv bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT 'invoice'::text, i.id, i.icv FROM public.tax_invoices i
   WHERE i.tenant_id = p_tenant AND i.icv > p_after AND i.signed_xml IS NULL
  UNION ALL
  SELECT 'credit_note'::text, r.id, r.icv FROM public.sales_returns r
   WHERE r.tenant_id = p_tenant AND r.icv > p_after AND r.signed_xml IS NULL;
$function$;

-- Take the shop's signing turn for two minutes. The chain starts after the
-- last document issued before p_since (the production certificate's date).
-- Returns null while another signer holds the turn.
CREATE OR REPLACE FUNCTION public.zatca_signing_begin(p_tenant uuid, p_since timestamptz, p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_state record;
  v_start bigint;
  v_after bigint;
  v_token uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.zatca_invoice_chain_state (tenant_id) VALUES (p_tenant) ON CONFLICT (tenant_id) DO NOTHING;
  SELECT * INTO v_state FROM public.zatca_invoice_chain_state WHERE tenant_id = p_tenant FOR UPDATE;
  IF v_state.signing_until IS NOT NULL AND v_state.signing_until > now() THEN
    RETURN NULL;
  END IF;
  v_start := v_state.chain_start_icv;
  IF v_start IS NULL THEN
    SELECT min(d.icv) - 1 INTO v_start FROM (
      SELECT icv FROM public.tax_invoices WHERE tenant_id = p_tenant AND icv IS NOT NULL AND issued_at >= p_since
      UNION ALL
      SELECT icv FROM public.sales_returns WHERE tenant_id = p_tenant AND icv IS NOT NULL AND created_at >= p_since) d;
    v_start := COALESCE(v_start, v_state.last_icv);
  END IF;
  v_after := COALESCE(v_state.last_signed_icv, v_start);
  UPDATE public.zatca_invoice_chain_state
     SET chain_start_icv = v_start, signing_token = v_token, signing_until = now() + interval '2 minutes'
   WHERE tenant_id = p_tenant;
  RETURN jsonb_build_object(
    'token', v_token,
    'pih', COALESCE(v_state.last_signed_hash, public.zatca_first_pih()),
    'pending', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', u.kind, 'id', u.id, 'icv', u.icv) ORDER BY u.icv)
                           FROM (SELECT * FROM public.zatca_unsigned_documents(p_tenant, v_after) ORDER BY icv LIMIT GREATEST(p_limit, 1)) u),
                        '[]'::jsonb));
END;
$function$;

-- Keep one signed document. Refused unless it is the very next one in the
-- chain and was signed with the chain's current PIH.
CREATE OR REPLACE FUNCTION public.zatca_signing_store(
  p_tenant uuid, p_token uuid, p_kind text, p_id uuid, p_icv bigint,
  p_pih text, p_hash text, p_xml text, p_qr text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_state record;
  v_next  bigint;
  n       int;
BEGIN
  SELECT * INTO v_state FROM public.zatca_invoice_chain_state WHERE tenant_id = p_tenant FOR UPDATE;
  IF v_state.signing_token IS DISTINCT FROM p_token OR v_state.signing_until < now() THEN
    RAISE EXCEPTION 'signing turn lost' USING ERRCODE = '40001';
  END IF;
  SELECT min(u.icv) INTO v_next FROM public.zatca_unsigned_documents(p_tenant, COALESCE(v_state.last_signed_icv, v_state.chain_start_icv)) u;
  IF v_next IS DISTINCT FROM p_icv THEN
    RAISE EXCEPTION 'document % is not the next in the chain (next is %)', p_icv, v_next USING ERRCODE = '22023';
  END IF;
  IF p_pih IS DISTINCT FROM COALESCE(v_state.last_signed_hash, public.zatca_first_pih()) THEN
    RAISE EXCEPTION 'signed with a stale PIH' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'invoice' THEN
    UPDATE public.tax_invoices SET signed_xml = p_xml, invoice_hash = p_hash, previous_invoice_hash = p_pih, zatca_qr = p_qr, signed_at = now()
     WHERE id = p_id AND tenant_id = p_tenant AND icv = p_icv AND signed_xml IS NULL;
  ELSE
    UPDATE public.sales_returns SET signed_xml = p_xml, invoice_hash = p_hash, previous_invoice_hash = p_pih, zatca_qr = p_qr, signed_at = now()
     WHERE id = p_id AND tenant_id = p_tenant AND icv = p_icv AND signed_xml IS NULL;
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'document % not found or already signed', p_id USING ERRCODE = '22023'; END IF;
  UPDATE public.zatca_invoice_chain_state
     SET last_signed_icv = p_icv, last_signed_hash = p_hash, signing_until = now() + interval '2 minutes', updated_at = now()
   WHERE tenant_id = p_tenant;
END;
$function$;

CREATE OR REPLACE FUNCTION public.zatca_signing_end(p_tenant uuid, p_token uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  UPDATE public.zatca_invoice_chain_state SET signing_token = NULL, signing_until = NULL
   WHERE tenant_id = p_tenant AND signing_token = p_token;
$function$;

REVOKE ALL ON FUNCTION public.zatca_first_pih() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zatca_unsigned_documents(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zatca_signing_begin(uuid, timestamptz, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zatca_signing_store(uuid, uuid, text, uuid, bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zatca_signing_end(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zatca_unsigned_documents(uuid, bigint), public.zatca_signing_begin(uuid, timestamptz, int),
  public.zatca_signing_store(uuid, uuid, text, uuid, bigint, text, text, text, text), public.zatca_signing_end(uuid, uuid) TO service_role;

-- ZATCA-12: PostgreSQL's base64 wraps every 76 characters; a QR has no line breaks.
CREATE OR REPLACE FUNCTION public.zatca_qr_payload(p_seller_name text, p_trn text, p_timestamp timestamp with time zone, p_total text, p_vat_amount text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT translate(encode(
    public.zatca_qr_tlv(1, p_seller_name) ||
    public.zatca_qr_tlv(2, p_trn) ||
    public.zatca_qr_tlv(3, to_char(p_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS."000Z"')) ||
    public.zatca_qr_tlv(4, p_total) ||
    public.zatca_qr_tlv(5, p_vat_amount),
    'base64'
  ), E'\n\r', '');
$function$;

-- ZATCA-14: a credit note is a fixed record, like a tax invoice.
DROP TRIGGER IF EXISTS trg_sales_returns_immutable ON public.sales_returns;
CREATE TRIGGER trg_sales_returns_immutable BEFORE UPDATE OR DELETE ON public.sales_returns
FOR EACH ROW EXECUTE FUNCTION public.prevent_tax_invoice_tamper();
REVOKE UPDATE, DELETE ON public.sales_returns FROM anon, authenticated;
