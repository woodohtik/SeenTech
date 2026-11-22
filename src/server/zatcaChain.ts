import { signZatcaDocument, type ZatcaDocumentInput, type ZatcaInvoiceLine, type ZatcaParty } from './zatcaInvoiceXml';
import { readZatcaCertificate } from './zatcaXades';

/**
 * seen-readiness-fixes-task.md P2.1/P2.2 (ZATCA-07, ZATCA-08, ZATCA-10,
 * ZATCA-11) -- a shop's documents are signed strictly in ICV order, each with
 * the real hash of the one before it (PIH), from what was fixed when it was
 * issued (20270103000001: icv, zatca_uuid, issued_at, lines). The signed XML
 * is kept and is what gets sent, and resent.
 */

/** A line as tax_invoices.lines / sales_returns.lines keep it. */
export type StoredLine = {
  name?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  price?: number | string | null;
  tax_type?: string | null;
  net?: number | string | null;
  tax?: number | string | null;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/** The fixed lines in ZATCA's terms. Lines from before P1 (no net/tax kept) are worked out from price x quantity. */
export function linesFromSnapshot(lines: StoredLine[], ratePercent: number): ZatcaInvoiceLine[] {
  return lines.map((l, i) => {
    const qty = (num(l.quantity) ?? 0) > 0 ? Number(l.quantity) : 1;
    const net = num(l.net) ?? r2(qty * (num(l.price) ?? 0));
    const exempt = l.tax_type === 'exempt';
    const tax = num(l.tax) ?? (exempt ? 0 : r2(net * ratePercent / 100));
    const taxed = !exempt && tax !== 0 && ratePercent > 0;
    return {
      id: String(i + 1),
      itemName: (l.name || 'منتج').slice(0, 1000),
      quantity: qty,
      ...(l.unit === 'meter' ? { unitCode: 'MTR' } : l.unit === 'yard' ? { unitCode: 'YRD' } : {}),
      lineExtensionAmount: net,
      taxAmount: tax,
      taxPercent: taxed ? ratePercent : 0,
      taxCategory: taxed ? 'S' as const : 'O' as const,
    };
  });
}

/** Saudi local date and time (UTC+3, no daylight saving) of an instant. */
export function riyadhDateTime(at: string | Date): { date: string; time: string } {
  const iso = new Date(new Date(at).getTime() + 3 * 3600_000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

/** UNCL 4461, the codes ZATCA accepts. */
export function paymentMeansCode(method?: string | null): string {
  switch (method) {
    case 'cash': return '10';
    case 'card': case 'network': case 'mada': return '48';
    case 'bank_transfer': return '42';
    default: return '1';
  }
}

export type Db = { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

export type SignKey = { privateKeyPem: string; certificate: string; since: string };

type Pending = { kind: 'invoice' | 'credit_note'; id: string; icv: number };

async function documentInput(db: Db, tenantId: string, p: Pending, seller: ZatcaParty, pih: string): Promise<ZatcaDocumentInput> {
  const { decodeOrderB2BNotes } = await import('../utils/b2bHelper');
  const { taxRatePercent } = await import('../shared/taxRate');
  const buyerFor = async (orderId: string | null) => {
    if (!orderId) return { order: null, buyer: undefined };
    const { data: order } = await db.from('orders').select('notes, payment_method').eq('id', orderId).eq('tenant_id', tenantId).maybeSingle();
    const b2b = decodeOrderB2BNotes(order?.notes ?? null);
    return {
      order,
      buyer: b2b.isB2B ? { legalName: b2b.b2bCompanyName || '', vatNumber: b2b.b2bTRN || '' } : undefined,
    };
  };

  if (p.kind === 'invoice') {
    const { data: inv } = await db.from('tax_invoices')
      .select('id, order_id, invoice_number, issued_at, zatca_uuid, icv, lines, tax_rate')
      .eq('id', p.id).eq('tenant_id', tenantId).maybeSingle();
    if (!inv) throw new Error(`invoice ${p.id} not found`);
    const { order, buyer } = await buyerFor(inv.order_id);
    const at = riyadhDateTime(inv.issued_at);
    return {
      type: 'invoice', simplified: !buyer, invoiceNumber: inv.invoice_number, uuid: inv.zatca_uuid,
      issueDate: at.date, issueTime: at.time, icv: Number(inv.icv), pih, seller, buyer,
      paymentMeansCode: paymentMeansCode(order?.payment_method),
      lines: linesFromSnapshot(inv.lines || [], taxRatePercent(inv.tax_rate) ?? 0),
    };
  }

  const { data: note } = await db.from('sales_returns')
    .select('id, invoice_id, order_id, return_number, reason, created_at, zatca_uuid, icv, lines, refund_method')
    .eq('id', p.id).eq('tenant_id', tenantId).maybeSingle();
  if (!note) throw new Error(`credit note ${p.id} not found`);
  const { data: original } = await db.from('tax_invoices').select('invoice_number, tax_rate')
    .eq('id', note.invoice_id).eq('tenant_id', tenantId).maybeSingle();
  if (!original) throw new Error(`original invoice of credit note ${p.id} not found`);
  const { buyer } = await buyerFor(note.order_id);
  const at = riyadhDateTime(note.created_at);
  return {
    type: 'credit_note', simplified: !buyer, invoiceNumber: `CN-${note.return_number}`, uuid: note.zatca_uuid,
    issueDate: at.date, issueTime: at.time, icv: Number(note.icv), pih, seller, buyer,
    paymentMeansCode: paymentMeansCode(note.refund_method),
    billingReference: original.invoice_number, reason: note.reason || 'مرتجع',
    lines: linesFromSnapshot(note.lines || [], taxRatePercent(original.tax_rate) ?? 0),
  };
}

export type SignResult = { signed: number; busy?: boolean; error?: string };

/**
 * Signs the shop's unsigned documents in ICV order (up to `limit`). Holds the
 * shop's signing turn (zatca_signing_begin) so no two signers interleave; the
 * database refuses any document that is not the very next one or that was
 * signed with a stale PIH.
 */
export async function signPendingDocuments(db: Db, tenantId: string, seller: ZatcaParty, key: SignKey, limit = 50): Promise<SignResult> {
  const { data: turn, error } = await db.rpc('zatca_signing_begin', { p_tenant: tenantId, p_since: key.since, p_limit: limit });
  if (error) return { signed: 0, error: error.message };
  if (!turn) return { signed: 0, busy: true };
  const certificate = readZatcaCertificate(key.certificate);
  let pih: string = turn.pih;
  let signed = 0;
  try {
    for (const p of (turn.pending || []) as Pending[]) {
      const input = await documentInput(db, tenantId, p, seller, pih);
      const now = riyadhDateTime(new Date());
      const doc = signZatcaDocument(input, { privateKeyPem: key.privateKeyPem, certificate, signingTime: `${now.date}T${now.time}` });
      const { error: storeError } = await db.rpc('zatca_signing_store', {
        p_tenant: tenantId, p_token: turn.token, p_kind: p.kind, p_id: p.id, p_icv: p.icv,
        p_pih: pih, p_hash: doc.invoiceHash, p_xml: doc.xml, p_qr: doc.qr,
      });
      if (storeError) return { signed, error: storeError.message };
      pih = doc.invoiceHash;
      signed++;
    }
    return { signed };
  } catch (err: any) {
    return { signed, error: String(err?.message || err) };
  } finally {
    await db.rpc('zatca_signing_end', { p_tenant: tenantId, p_token: turn.token });
  }
}
