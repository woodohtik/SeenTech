import { describe, expect, it } from 'vitest';
import { linesFromSnapshot, paymentMeansCode, riyadhDateTime, signPendingDocuments, type Db } from './zatcaChain';
import { makeTestCertificate } from './zatcaTestCertificate';
import { ZATCA_FIRST_PIH, readZatcaCertificate, verifyInvoiceHashSignature, zatcaInvoiceHash } from './zatcaXades';

// seen-readiness-fixes-task.md P2.1/P2.2. A test-only key and certificate, made in memory.
const testCert = makeTestCertificate();
const key = { privateKeyPem: testCert.privateKeyPem, certificate: testCert.certificatePem, since: '2026-11-01T00:00:00Z' };
const seller = { legalName: 'مشغل', vatNumber: '399999999900003' };
const T = 'tenant-1';

function fakeDb(rows: Record<string, any[]>, pending: any[]) {
  const calls: Array<[string, any]> = [];
  const db: Db = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
        maybeSingle: async () => ({ data: (rows[table] || []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null }),
      };
      return q;
    },
    async rpc(fn: string, args?: any) {
      calls.push([fn, args]);
      if (fn === 'zatca_signing_begin') return { data: { token: 'tok', pih: ZATCA_FIRST_PIH, pending }, error: null };
      return { data: null, error: null };
    },
  };
  return { db, calls };
}

const invoice = (id: string, icv: number, lines: any[]) => ({
  id, tenant_id: T, order_id: `o-${id}`, invoice_number: `INV-${icv}`, issued_at: '2026-11-22T07:15:00Z',
  zatca_uuid: `00000000-0000-0000-0000-00000000000${icv}`, icv, lines, tax_rate: 0.15,
});
const rows = () => ({
  tax_invoices: [
    invoice('i1', 1, [{ name: 'ثوب', quantity: 1, tax_type: 'inclusive', net: 100, tax: 15 }]),
    invoice('i2', 2, [{ name: 'قماش', quantity: 2.5, unit: 'meter', tax_type: 'exclusive', net: 50, tax: 7.5 }]),
  ],
  sales_returns: [{ id: 'c3', tenant_id: T, invoice_id: 'i1', order_id: 'o-i1', return_number: 'R-1', reason: 'إرجاع',
    created_at: '2026-11-22T08:00:00Z', zatca_uuid: '00000000-0000-0000-0000-000000000003', icv: 3,
    lines: [{ name: 'إرجاع', quantity: 1, tax_type: 'exclusive', net: 50, tax: 7.5 }], refund_method: 'cash' }],
  orders: [{ id: 'o-i1', tenant_id: T, notes: null, payment_method: 'cash' }, { id: 'o-i2', tenant_id: T, notes: null, payment_method: 'card' }],
});
const PENDING = [{ kind: 'invoice', id: 'i1', icv: 1 }, { kind: 'invoice', id: 'i2', icv: 2 }, { kind: 'credit_note', id: 'c3', icv: 3 }];

describe('signPendingDocuments', () => {
  it('signs in ICV order, each with the previous real hash as PIH, and gives the turn back', async () => {
    const { db, calls } = fakeDb(rows(), PENDING);
    const r = await signPendingDocuments(db, T, seller, key);
    expect(r).toEqual({ signed: 3 });
    const stores = calls.filter(([fn]) => fn === 'zatca_signing_store').map(([, a]) => a);
    expect(stores.map((s) => s.p_icv)).toEqual([1, 2, 3]);
    expect(stores[0].p_pih).toBe(ZATCA_FIRST_PIH);
    expect(stores[1].p_pih).toBe(stores[0].p_hash);
    expect(stores[2].p_pih).toBe(stores[1].p_hash);
    for (const s of stores) {
      expect(zatcaInvoiceHash(s.p_xml)).toBe(s.p_hash);
      expect(s.p_xml).toContain(`<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${s.p_pih}</cbc:EmbeddedDocumentBinaryObject>`);
    }
    const cert = readZatcaCertificate(key.certificate);
    const sig = stores[0].p_xml.match(/<ds:SignatureValue>([^<]+)</)[1];
    expect(verifyInvoiceHashSignature(stores[0].p_hash, sig, cert)).toBe(true);
    // The fixed facts of each document, not the moment of signing.
    expect(stores[0].p_xml).toContain('<cbc:IssueDate>2026-11-22</cbc:IssueDate><cbc:IssueTime>10:15:00</cbc:IssueTime>');
    expect(stores[0].p_xml).toContain('<cbc:UUID>00000000-0000-0000-0000-000000000001</cbc:UUID>');
    expect(stores[1].p_xml).toContain('<cbc:PaymentMeansCode>48</cbc:PaymentMeansCode>');
    expect(stores[2].p_xml).toContain('<cbc:ID>CN-R-1</cbc:ID>');
    expect(stores[2].p_xml).toContain('<cbc:ID>INV-1</cbc:ID></cac:InvoiceDocumentReference>');
    expect(calls.at(-1)).toEqual(['zatca_signing_end', { p_tenant: T, p_token: 'tok' }]);
  });

  it('a document that cannot be built stops the chain there, and the turn is still given back', async () => {
    const data = rows();
    data.tax_invoices[1].lines = [];
    const { db, calls } = fakeDb(data, PENDING);
    const r = await signPendingDocuments(db, T, seller, key);
    expect(r.signed).toBe(1);
    expect(r.error).toMatch(/at least one line/);
    expect(calls.filter(([fn]) => fn === 'zatca_signing_store')).toHaveLength(1);
    expect(calls.at(-1)?.[0]).toBe('zatca_signing_end');
  });

  it('another signer holding the turn means busy, nothing signed', async () => {
    const db: Db = { from: () => ({}), rpc: async () => ({ data: null, error: null }) };
    expect(await signPendingDocuments(db, T, seller, key)).toEqual({ signed: 0, busy: true });
  });
});

describe('the fixed lines in ZATCA terms', () => {
  it('uses the amounts as charged; an exempt line is not subject to VAT; metres are MTR', () => {
    const [a, b, c] = linesFromSnapshot([
      { name: 'ثوب', quantity: 1, tax_type: 'inclusive', net: 86.96, tax: 13.04 },
      { name: 'هدية', quantity: 1, tax_type: 'exempt', net: 20, tax: 0 },
      { name: 'قماش', quantity: '2.5', unit: 'meter', net: '50', tax: '7.5' },
    ], 15);
    expect(a).toMatchObject({ lineExtensionAmount: 86.96, taxAmount: 13.04, taxPercent: 15, taxCategory: 'S' });
    expect(b).toMatchObject({ taxPercent: 0, taxCategory: 'O' });
    expect(c).toMatchObject({ quantity: 2.5, unitCode: 'MTR', lineExtensionAmount: 50 });
  });
  it('a line from before P1 (no amounts kept) is price x quantity at the rate', () => {
    expect(linesFromSnapshot([{ name: 'x', quantity: 2, price: 10 }], 15)[0]).toMatchObject({ lineExtensionAmount: 20, taxAmount: 3 });
  });
});

describe('dates and payment codes', () => {
  it('writes Saudi local time (UTC+3)', () => {
    expect(riyadhDateTime('2026-11-22T22:30:00Z')).toEqual({ date: '2026-11-23', time: '01:30:00' });
  });
  it('maps payment methods to the codes ZATCA accepts', () => {
    expect(paymentMeansCode('cash')).toBe('10');
    expect(paymentMeansCode('card')).toBe('48');
    expect(paymentMeansCode('bank_transfer')).toBe('42');
    expect(paymentMeansCode('credit')).toBe('1');
  });
});
