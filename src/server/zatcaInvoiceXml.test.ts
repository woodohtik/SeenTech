import { describe, expect, it } from 'vitest';
import { create } from 'xmlbuilder2';
import { buildSimplifiedInvoiceXml, type ZatcaSimplifiedInvoiceInput } from './zatcaInvoiceXml';

// These tests verify the XML this module produces is well-formed and
// contains the fields it was given in the expected places -- NOT that
// ZATCA's own validator would accept it (see the module-level confidence
// note in zatcaInvoiceXml.ts for what is and isn't verified here).

function sampleInput(overrides: Partial<ZatcaSimplifiedInvoiceInput> = {}): ZatcaSimplifiedInvoiceInput {
  return {
    invoiceNumber: 'INV-1001',
    uuid: '3cf5ee18-1234-4a5b-9abc-000000000001',
    issueDateIso: '2026-09-17',
    issueTimeIso: '14:32:00',
    seller: {
      legalName: 'مؤسسة الاختبار للخياطة',
      vatNumber: '310000000000003',
      crn: '1010101010',
      city: 'الرياض',
      countryCode: 'SA',
    },
    paymentMeansCode: '10',
    lines: [
      {
        id: '1',
        itemName: 'ثوب قطن',
        quantity: 1,
        unitPrice: 100,
        lineExtensionAmount: 100,
        taxPercent: 15,
        taxAmount: 15,
      },
    ],
    subtotal: 100,
    taxAmount: 15,
    totalWithTax: 115,
    previousInvoiceHash: 'PREVHASH==',
    invoiceHash: 'THISHASH==',
    ...overrides,
  };
}

describe('buildSimplifiedInvoiceXml', () => {
  it('produces well-formed XML (re-parses without throwing)', () => {
    const xml = buildSimplifiedInvoiceXml(sampleInput());
    expect(() => create(xml)).not.toThrow();
  });

  it('declares the required UBL namespaces on the root Invoice element', () => {
    const xml = buildSimplifiedInvoiceXml(sampleInput());
    expect(xml).toContain('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
    expect(xml).toContain('urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2');
    expect(xml).toContain('urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2');
    expect(xml).toContain('urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2');
  });

  it('includes the invoice number, UUID, and issue date/time', () => {
    const xml = buildSimplifiedInvoiceXml(sampleInput());
    expect(xml).toContain('<cbc:ID>INV-1001</cbc:ID>');
    expect(xml).toContain('<cbc:UUID>3cf5ee18-1234-4a5b-9abc-000000000001</cbc:UUID>');
    expect(xml).toContain('<cbc:IssueDate>2026-09-17</cbc:IssueDate>');
    expect(xml).toContain('<cbc:IssueTime>14:32:00</cbc:IssueTime>');
  });

  it('includes the seller legal name and VAT number', () => {
    const xml = buildSimplifiedInvoiceXml(sampleInput());
    expect(xml).toContain('<cbc:RegistrationName>مؤسسة الاختبار للخياطة</cbc:RegistrationName>');
    expect(xml).toContain('<cbc:CompanyID>310000000000003</cbc:CompanyID>');
  });

  it('includes the previous invoice hash (PIH) when present', () => {
    const xml = buildSimplifiedInvoiceXml(sampleInput({ previousInvoiceHash: 'PREVHASH==' }));
    expect(xml).toContain('<cbc:ID>PIH</cbc:ID>');
    expect(xml).toContain('PREVHASH==');
  });

  it('omits the PIH reference for the first invoice in a chain (previousInvoiceHash null)', () => {
    const xml = buildSimplifiedInvoiceXml(sampleInput({ previousInvoiceHash: null }));
    expect(xml).not.toContain('<cbc:ID>PIH</cbc:ID>');
  });

  it('includes a signature block only when a signature was actually provided', () => {
    const withoutSignature = buildSimplifiedInvoiceXml(sampleInput());
    expect(withoutSignature).not.toContain('UBLDocumentSignatures');

    const withSignature = buildSimplifiedInvoiceXml(sampleInput({ signatureBase64: 'SIGVALUE==' }));
    expect(withSignature).toContain('UBLDocumentSignatures');
    expect(withSignature).toContain('SIGVALUE==');
  });

  it('includes every invoice line with its amounts', () => {
    const xml = buildSimplifiedInvoiceXml(sampleInput({
      lines: [
        { id: '1', itemName: 'ثوب قطن', quantity: 2, unitPrice: 50, lineExtensionAmount: 100, taxPercent: 15, taxAmount: 15 },
        { id: '2', itemName: 'مقاس تفصيل', quantity: 1, unitPrice: 200, lineExtensionAmount: 200, taxPercent: 15, taxAmount: 30 },
      ],
    }));
    const lineCount = (xml.match(/<cac:InvoiceLine>/g) || []).length;
    expect(lineCount).toBe(2);
    expect(xml).toContain('<cbc:Name>ثوب قطن</cbc:Name>');
    expect(xml).toContain('<cbc:Name>مقاس تفصيل</cbc:Name>');
  });

  it('formats monetary amounts to two decimal places', () => {
    const xml = buildSimplifiedInvoiceXml(sampleInput({ subtotal: 100, taxAmount: 15, totalWithTax: 115 }));
    expect(xml).toContain('<cbc:PayableAmount currencyID="SAR">115.00</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:TaxAmount currencyID="SAR">15.00</cbc:TaxAmount>');
  });
});
