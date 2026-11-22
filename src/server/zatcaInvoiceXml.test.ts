import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { create } from 'xmlbuilder2';
import { buildZatcaDocument, signZatcaDocument, zatcaTotals, type ZatcaDocumentInput } from './zatcaInvoiceXml';
import {
  ZATCA_FIRST_PIH, readQrTags, readZatcaCertificate, signedPropertiesForDigest, signedPropertiesInDocument,
  verifyInvoiceHashSignature, zatcaHashInput, zatcaInvoiceHash, qrFromDocument,
} from './zatcaXades';
import taxCases from '../shared/taxEngineCases.json';

// seen-readiness-fixes-task.md P2.1. Test-only key and self-signed
// certificate (src/server/__fixtures__) -- never issued by ZATCA.
const FIX = path.join(__dirname, '__fixtures__');
const privateKeyPem = fs.readFileSync(path.join(FIX, 'zatca-test-key.pem'), 'utf8');
const certificate = readZatcaCertificate(fs.readFileSync(path.join(FIX, 'zatca-test-cert.pem'), 'utf8'));
const key = { privateKeyPem, certificate, signingTime: '2026-11-22T10:15:00' };

const seller = { legalName: 'مشغل سين للخياطة', vatNumber: '399999999900003', crn: '1010010000', street: 'شارع الملك فهد', buildingNumber: '1234', district: 'العليا', city: 'الرياض', postalCode: '12345' };

function input(over: Partial<ZatcaDocumentInput> = {}): ZatcaDocumentInput {
  return {
    type: 'invoice', simplified: true, invoiceNumber: 'INV-0001', uuid: '3cf5ee18-ee25-44ea-a444-2c37ba7f28be',
    issueDate: '2026-11-22', issueTime: '10:15:00', icv: 1, pih: ZATCA_FIRST_PIH, seller, paymentMeansCode: '10',
    lines: [
      { id: '1', itemName: 'ثوب', quantity: 1, lineExtensionAmount: 100, taxAmount: 15, taxPercent: 15 },
      { id: '2', itemName: 'قماش قطن', quantity: 2.5, unitCode: 'MTR', lineExtensionAmount: 50, taxAmount: 7.5, taxPercent: 15 },
    ],
    ...over,
  };
}

const text = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'g'))].map((m) => m[1]);

describe('the first PIH', () => {
  it('is base64 of the hex SHA-256 of "0" (the value ZATCA publishes)', () => {
    expect(ZATCA_FIRST_PIH).toBe('NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==');
  });
});

describe('the document', () => {
  it('carries ICV, PIH, cac:Signature, the tax total twice and the elements in UBL order', () => {
    const xml = signZatcaDocument(input({ icv: 7, pih: 'UFJFVg==' }), key).xml;
    expect(() => create(xml)).not.toThrow();
    const order = ['ext:UBLExtensions', 'cbc:ProfileID', 'cbc:ID>INV', 'cbc:UUID>3cf5', 'cbc:IssueDate', 'cbc:IssueTime', 'cbc:InvoiceTypeCode',
      'cbc:DocumentCurrencyCode', 'cbc:TaxCurrencyCode', '<cbc:ID>ICV', '<cbc:ID>PIH', '<cbc:ID>QR', '<cac:Signature>',
      'cac:AccountingSupplierParty', 'cac:AccountingCustomerParty', 'cac:PaymentMeans', 'cac:TaxTotal', 'cac:LegalMonetaryTotal', 'cac:InvoiceLine'];
    const at = order.map((t) => xml.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(xml).toContain('<cbc:ID>ICV</cbc:ID><cbc:UUID>7</cbc:UUID>');
    expect(xml).toContain('<cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">UFJFVg==</cbc:EmbeddedDocumentBinaryObject>');
    expect(xml.match(/<cac:TaxTotal>/g)?.length).toBe(1 + 1 + 2); // the document's two, one per line
    expect(xml).toContain('<cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>');
    expect(xml).toContain('<cbc:InvoicedQuantity unitCode="MTR">2.5</cbc:InvoicedQuantity>');
    expect(xml).toContain('<cbc:BuildingNumber>1234</cbc:BuildingNumber>');
  });

  it('has no whitespace between elements (nothing left behind when the signature is taken out)', () => {
    const xml = signZatcaDocument(input(), key).xml;
    expect(xml).not.toMatch(/>\s+</);
  });

  it('a standard invoice has the buyer, the supply date and no QR', () => {
    const doc = signZatcaDocument(input({ simplified: false, buyer: { legalName: 'شركة', vatNumber: '300000000000003', city: 'جدة' } }), key);
    expect(doc.qr).toBeNull();
    expect(doc.xml).toContain('<cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>');
    expect(doc.xml).toContain('<cac:Delivery><cbc:ActualDeliveryDate>2026-11-22</cbc:ActualDeliveryDate></cac:Delivery>');
    expect(doc.xml).not.toContain('<cbc:ID>QR</cbc:ID>');
  });

  it('a credit note references the invoice and gives its reason; a debit note is 383', () => {
    const cn = signZatcaDocument(input({ type: 'credit_note', billingReference: 'INV-0001', reason: 'إرجاع ثوب' }), key).xml;
    expect(cn).toContain('<cbc:InvoiceTypeCode name="0200000">381</cbc:InvoiceTypeCode>');
    expect(cn).toContain('<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>INV-0001</cbc:ID>');
    expect(cn).toContain('<cbc:InstructionNote>إرجاع ثوب</cbc:InstructionNote>');
    const dn = buildZatcaDocument(input({ type: 'debit_note', billingReference: 'INV-0001', reason: 'x' }));
    expect(dn).toContain('>383</cbc:InvoiceTypeCode>');
    expect(() => buildZatcaDocument(input({ type: 'credit_note' }))).toThrow();
  });

  it('an item marked exempt is its own tax subtotal, not subject to VAT, with its reason', () => {
    const xml = buildZatcaDocument(input({ lines: [
      { id: '1', itemName: 'a', quantity: 1, lineExtensionAmount: 100, taxAmount: 15, taxPercent: 15 },
      { id: '2', itemName: 'b', quantity: 1, lineExtensionAmount: 20, taxAmount: 0, taxPercent: 0, taxCategory: 'O' },
    ] }));
    expect(xml.match(/<cac:TaxSubtotal>/g)?.length).toBe(2);
    expect(xml).toContain('<cbc:ID>O</cbc:ID><cbc:Percent>0</cbc:Percent><cbc:TaxExemptionReasonCode>VATEX-SA-OOS</cbc:TaxExemptionReasonCode>');
  });

  it('escapes what XML needs escaped', () => {
    const xml = buildZatcaDocument(input({ lines: [{ id: '1', itemName: 'A & B <C>', quantity: 1, lineExtensionAmount: 1, taxAmount: 0.15, taxPercent: 15 }] }));
    expect(xml).toContain('<cbc:Name>A &amp; B &lt;C&gt;</cbc:Name>');
  });
});

describe('the hash and the signature', () => {
  it('the hash is the same before the signature block exists and from the finished document', () => {
    const doc = signZatcaDocument(input(), key);
    expect(zatcaInvoiceHash(buildZatcaDocument(input()))).toBe(doc.invoiceHash);
    expect(zatcaInvoiceHash(doc.xml)).toBe(doc.invoiceHash);
    expect(text(doc.xml, 'ds:DigestValue')[0]).toBe(doc.invoiceHash);
  });

  it('the hashed form leaves out the extensions, cac:Signature and the QR, keeps ICV and PIH, and drops the XML declaration', () => {
    const c14n = zatcaHashInput(signZatcaDocument(input(), key).xml);
    expect(c14n.startsWith('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac=')).toBe(true);
    expect(c14n).not.toContain('UBLExtensions');
    expect(c14n).not.toContain('<cac:Signature>');
    expect(c14n).not.toContain('<cbc:ID>QR</cbc:ID>');
    expect(c14n).toContain('<cbc:ID>ICV</cbc:ID>');
    expect(c14n).toContain('<cbc:ID>PIH</cbc:ID>');
    expect(c14n).toContain('<cac:AccountingCustomerParty></cac:AccountingCustomerParty>'); // canonical: no self-closing
  });

  it('any change to the document changes the hash', () => {
    const a = zatcaInvoiceHash(buildZatcaDocument(input()));
    expect(zatcaInvoiceHash(buildZatcaDocument(input({ icv: 2 })))).not.toBe(a);
    expect(zatcaInvoiceHash(buildZatcaDocument(input({ invoiceNumber: 'INV-0002' })))).not.toBe(a);
  });

  it("the signature is DER and verifies with the certificate's key; a tampered hash does not", () => {
    const doc = signZatcaDocument(input(), key);
    expect(Buffer.from(doc.signature, 'base64')[0]).toBe(0x30); // DER SEQUENCE, not raw r||s
    expect(verifyInvoiceHashSignature(doc.invoiceHash, doc.signature, certificate)).toBe(true);
    const other = crypto.createHash('sha256').update('x').digest('base64');
    expect(verifyInvoiceHashSignature(other, doc.signature, certificate)).toBe(false);
  });

  it('the SignedProperties in the document are the ones whose digest is in SignedInfo', () => {
    const xml = signZatcaDocument(input(), key).xml;
    expect(signedPropertiesInDocument(xml)).toBe(signedPropertiesForDigest({ signingTime: key.signingTime, certificate }));
    expect(text(xml, 'ds:X509Certificate')[0]).toBe(certificate.base64);
    expect(text(xml, 'ds:X509SerialNumber')[0]).toBe(BigInt('0x1234567890abcdef').toString(10));
    expect(text(xml, 'ds:X509IssuerName')[0]).toBe('CN=TSZEINVOICE-SubCA-1-TEST, DC=extgazt, DC=gov, DC=local');
  });

  it("the certificate is read the same from a PEM and from ZATCA's binarySecurityToken", () => {
    const token = Buffer.from(certificate.base64).toString('base64');
    expect(readZatcaCertificate(token).digest).toBe(certificate.digest);
  });
});

describe('the Phase 2 QR', () => {
  it('has tags 1-9 with the values of the XML, in one base64 string without line breaks', () => {
    const doc = signZatcaDocument(input(), key);
    expect(doc.qr).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(qrFromDocument(doc.xml)).toBe(doc.qr);
    const tags = readQrTags(doc.qr!);
    expect([...tags.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(tags.get(1)!.toString('utf8')).toBe(seller.legalName);
    expect(tags.get(2)!.toString()).toBe(seller.vatNumber);
    expect(tags.get(3)!.toString()).toBe('2026-11-22T10:15:00');
    expect(tags.get(4)!.toString()).toBe('172.50');
    expect(tags.get(5)!.toString()).toBe('22.50');
    expect(tags.get(6)!.toString()).toBe(doc.invoiceHash);
    expect(tags.get(7)!.toString()).toBe(doc.signature);
    expect(tags.get(8)!.equals(certificate.publicKeyDer)).toBe(true);
    expect(tags.get(9)!.equals(certificate.signature)).toBe(true);
  });
});

// P1.1 carried into P2: every truth-table sale, from the figures each line was
// charged, gives a document whose lines add up to its header.
describe('the one tax engine in the XML', () => {
  const amounts = (xml: string, tag: string) =>
    [...xml.matchAll(new RegExp(`<cbc:${tag} currencyID="SAR">([0-9.]+)</cbc:${tag}>`, 'g'))].map((m) => Number(m[1]));
  it.each((taxCases as any[]).map((c) => [c.name, c]))('%s', (_n, c: any) => {
    const d = c.expected;
    const lines = d.lines.map((l: any, i: number) => ({
      id: String(i + 1), itemName: 'x', quantity: 1, lineExtensionAmount: l.netAfter, taxAmount: l.taxAfter,
      taxPercent: l.taxAfter === 0 ? 0 : c.input.rate * 100, taxCategory: l.taxType === 'exempt' ? 'O' as const : undefined,
    }));
    const xml = buildZatcaDocument(input({ lines }));
    expect(zatcaTotals(lines)).toEqual({ lineExtension: d.subtotal, tax: d.tax, taxInclusive: d.total });
    expect(amounts(xml, 'TaxInclusiveAmount')).toEqual([d.total]);
    expect(amounts(xml, 'PayableAmount')).toEqual([d.total]);
    const sub = amounts(xml, 'TaxableAmount');
    expect(Math.round(sub.reduce((s, x) => s + x, 0) * 100) / 100).toBe(d.subtotal);
  });
});
