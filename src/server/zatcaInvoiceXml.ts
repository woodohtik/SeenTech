import { create } from 'xmlbuilder2';

/**
 * ZATCA Phase 2 readiness (seen-zatca-readiness-task.md): builds a UBL 2.1
 * "Simplified Tax Invoice" XML document, the type ZATCA requires for B2C
 * sales (Reporting flow, 24h window) -- matching what POS.tsx currently
 * issues as a QR-only Phase 1 receipt.
 *
 * CONFIDENCE LEVELS (read before trusting any part of this against a real
 * ZATCA submission):
 *  - HIGH: the general UBL 2.1 invoice skeleton -- namespaces, supplier/
 *    customer party structure, tax total, legal monetary total, invoice
 *    lines. This is standard UBL, stable and widely documented.
 *  - LOWER, ZATCA-SPECIFIC, NEEDS VALIDATION: cbc:InvoiceTypeCode's `name`
 *    attribute (a 7-digit flag string ZATCA overlays on top of the
 *    standard UBL invoice type code) and the exact internal structure of
 *    the ext:UBLExtensions signature block (ZATCA's own sac:/sig:
 *    namespaces for UBLDocumentSignatures, not plain UBL). Both are
 *    implemented here to the best of available knowledge but have NOT
 *    been checked against ZATCA's actual XSD or a real compliance
 *    response, because there is no way to do that without a real
 *    Compliance CSID (Phase 1 -- a business-side task, see the task file).
 *    Cross-check both specifically against ZATCA's own published technical
 *    implementation guideline and reference examples before relying on
 *    this for a real submission.
 *
 * What IS verified (see zatcaInvoiceXml.test.ts): the output is
 * well-formed XML, uses the correct namespaces, and every field passed in
 * actually appears in the expected element -- not that ZATCA's validator
 * would accept it.
 */

export interface ZatcaInvoiceLine {
  id: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  /** Line total before tax (quantity * unitPrice, after any line-level discount). */
  lineExtensionAmount: number;
  /** VAT rate as a percentage, e.g. 15 for the standard Saudi rate. */
  taxPercent: number;
  taxAmount: number;
}

export interface ZatcaSimplifiedInvoiceInput {
  invoiceNumber: string;
  /** A UUID identifying this specific invoice instance (distinct from invoiceNumber, which is human-facing/sequential). */
  uuid: string;
  issueDateIso: string; // e.g. "2026-09-17"
  issueTimeIso: string; // e.g. "14:32:00"
  seller: {
    legalName: string;
    vatNumber: string;
    crn?: string; // Commercial Registration number, if available
    street?: string;
    city?: string;
    postalCode?: string;
    countryCode?: string; // ISO 3166-1 alpha-2, e.g. "SA"
  };
  /** ZATCA's own compliance/production request tracking, once Phase 1 exists -- not required for the XML itself. */
  paymentMeansCode: string; // UNCL4461, e.g. "10" = cash, "48" = card
  lines: ZatcaInvoiceLine[];
  subtotal: number; // sum of lineExtensionAmount
  taxAmount: number; // total VAT
  totalWithTax: number; // subtotal + taxAmount
  /** The previous-invoice-hash from the PIH chain (create_pos_sale / zatca_invoice_chain_state) -- null only for the very first invoice in a tenant's chain. */
  previousInvoiceHash: string | null;
  /** This invoice's own hash. Currently the placeholder hash from create_pos_sale (Phase 3) until Phase 2 wires up hashing this actual XML instead. */
  invoiceHash: string;
  /** Base64 XML-DSig signature over invoiceHash, once Phase 2's signing (zatcaSigning.ts) is wired to a real CSID. Omit while there is no real key yet. */
  signatureBase64?: string;
  /** Base64 of the signing certificate, embedded in UBLExtensions once available. */
  certificateBase64?: string;
}

const NS = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  sig: 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2',
  sac: 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2',
};

/** Builds the UBL Simplified Tax Invoice XML as a string. */
export function buildSimplifiedInvoiceXml(input: ZatcaSimplifiedInvoiceInput): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele(NS.invoice, 'Invoice', {
      'xmlns:cac': NS.cac,
      'xmlns:cbc': NS.cbc,
      'xmlns:ext': NS.ext,
    });

  // ext:UBLExtensions -- the digital signature envelope. ZATCA-specific
  // internal structure (sac:UBLDocumentSignatures/.../sig:...); see the
  // module-level confidence note above. Left mostly empty until a real
  // signature/certificate exist (Phase 1 + Phase 2), so an unsigned
  // "draft" of this invoice is still well-formed XML on its own.
  const ext = doc
    .ele(NS.ext, 'ext:UBLExtensions')
    .ele(NS.ext, 'ext:UBLExtension')
    .ele(NS.ext, 'ext:ExtensionURI').txt('urn:oasis:names:specification:ubl:dsig:enveloped:xades').up()
    .ele(NS.ext, 'ext:ExtensionContent');

  if (input.signatureBase64) {
    ext
      .ele(NS.sig, 'sig:UBLDocumentSignatures', { 'xmlns:sig': NS.sig, 'xmlns:sac': NS.sac })
      .ele(NS.sac, 'sac:SignatureInformation')
      .ele(NS.sac, 'sac:Signature').txt(input.signatureBase64).up()
      .up();
  }
  ext.up().up(); // back up to Invoice

  doc.ele(NS.cbc, 'cbc:ProfileID').txt('reporting:1.0').up();
  doc.ele(NS.cbc, 'cbc:ID').txt(input.invoiceNumber).up();
  doc.ele(NS.cbc, 'cbc:UUID').txt(input.uuid).up();
  doc.ele(NS.cbc, 'cbc:IssueDate').txt(input.issueDateIso).up();
  doc.ele(NS.cbc, 'cbc:IssueTime').txt(input.issueTimeIso).up();
  // "0200000": simplified tax invoice, no third-party billing/nominal
  // supply/export/summary/self-billing flags set -- see the module-level
  // confidence note; verify this exact digit string against ZATCA's own
  // guideline once you can.
  doc.ele(NS.cbc, 'cbc:InvoiceTypeCode', { name: '0200000' }).txt('388').up();
  doc.ele(NS.cbc, 'cbc:DocumentCurrencyCode').txt('SAR').up();
  doc.ele(NS.cbc, 'cbc:TaxCurrencyCode').txt('SAR').up();

  if (input.previousInvoiceHash) {
    doc
      .ele(NS.cac, 'cac:AdditionalDocumentReference')
      .ele(NS.cbc, 'cbc:ID').txt('PIH').up()
      .ele(NS.cac, 'cac:Attachment')
      .ele(NS.cbc, 'cbc:EmbeddedDocumentBinaryObject', { mimeCode: 'text/plain' }).txt(input.previousInvoiceHash).up()
      .up()
      .up();
  }

  const supplierParty = doc.ele(NS.cac, 'cac:AccountingSupplierParty').ele(NS.cac, 'cac:Party');
  if (input.seller.crn) {
    supplierParty
      .ele(NS.cac, 'cac:PartyIdentification')
      .ele(NS.cbc, 'cbc:ID', { schemeID: 'CRN' }).txt(input.seller.crn).up()
      .up();
  }
  if (input.seller.street || input.seller.city || input.seller.countryCode) {
    const address = supplierParty.ele(NS.cac, 'cac:PostalAddress');
    if (input.seller.street) address.ele(NS.cbc, 'cbc:StreetName').txt(input.seller.street).up();
    if (input.seller.city) address.ele(NS.cbc, 'cbc:CityName').txt(input.seller.city).up();
    if (input.seller.postalCode) address.ele(NS.cbc, 'cbc:PostalZone').txt(input.seller.postalCode).up();
    address.ele(NS.cac, 'cac:Country').ele(NS.cbc, 'cbc:IdentificationCode').txt(input.seller.countryCode || 'SA').up().up();
    address.up();
  }
  supplierParty
    .ele(NS.cac, 'cac:PartyTaxScheme')
    .ele(NS.cbc, 'cbc:CompanyID').txt(input.seller.vatNumber).up()
    .ele(NS.cac, 'cac:TaxScheme').ele(NS.cbc, 'cbc:ID').txt('VAT').up().up()
    .up();
  supplierParty
    .ele(NS.cac, 'cac:PartyLegalEntity')
    .ele(NS.cbc, 'cbc:RegistrationName').txt(input.seller.legalName).up()
    .up();
  supplierParty.up().up();

  doc
    .ele(NS.cac, 'cac:PaymentMeans')
    .ele(NS.cbc, 'cbc:PaymentMeansCode').txt(input.paymentMeansCode).up()
    .up();

  const taxTotal = doc.ele(NS.cac, 'cac:TaxTotal');
  taxTotal.ele(NS.cbc, 'cbc:TaxAmount', { currencyID: 'SAR' }).txt(input.taxAmount.toFixed(2)).up();
  const taxSubtotal = taxTotal.ele(NS.cac, 'cac:TaxSubtotal');
  taxSubtotal.ele(NS.cbc, 'cbc:TaxableAmount', { currencyID: 'SAR' }).txt(input.subtotal.toFixed(2)).up();
  taxSubtotal.ele(NS.cbc, 'cbc:TaxAmount', { currencyID: 'SAR' }).txt(input.taxAmount.toFixed(2)).up();
  const taxCategory = taxSubtotal.ele(NS.cac, 'cac:TaxCategory');
  taxCategory.ele(NS.cbc, 'cbc:ID').txt('S').up();
  taxCategory.ele(NS.cbc, 'cbc:Percent').txt(String(input.lines[0]?.taxPercent ?? 15)).up();
  taxCategory.ele(NS.cac, 'cac:TaxScheme').ele(NS.cbc, 'cbc:ID').txt('VAT').up().up();
  taxCategory.up();
  taxSubtotal.up();
  taxTotal.up();

  const monetaryTotal = doc.ele(NS.cac, 'cac:LegalMonetaryTotal');
  monetaryTotal.ele(NS.cbc, 'cbc:LineExtensionAmount', { currencyID: 'SAR' }).txt(input.subtotal.toFixed(2)).up();
  monetaryTotal.ele(NS.cbc, 'cbc:TaxExclusiveAmount', { currencyID: 'SAR' }).txt(input.subtotal.toFixed(2)).up();
  monetaryTotal.ele(NS.cbc, 'cbc:TaxInclusiveAmount', { currencyID: 'SAR' }).txt(input.totalWithTax.toFixed(2)).up();
  monetaryTotal.ele(NS.cbc, 'cbc:PayableAmount', { currencyID: 'SAR' }).txt(input.totalWithTax.toFixed(2)).up();
  monetaryTotal.up();

  for (const line of input.lines) {
    const invoiceLine = doc.ele(NS.cac, 'cac:InvoiceLine');
    invoiceLine.ele(NS.cbc, 'cbc:ID').txt(line.id).up();
    invoiceLine.ele(NS.cbc, 'cbc:InvoicedQuantity').txt(String(line.quantity)).up();
    invoiceLine.ele(NS.cbc, 'cbc:LineExtensionAmount', { currencyID: 'SAR' }).txt(line.lineExtensionAmount.toFixed(2)).up();
    const lineTax = invoiceLine.ele(NS.cac, 'cac:TaxTotal');
    lineTax.ele(NS.cbc, 'cbc:TaxAmount', { currencyID: 'SAR' }).txt(line.taxAmount.toFixed(2)).up();
    lineTax.up();
    const item = invoiceLine.ele(NS.cac, 'cac:Item');
    item.ele(NS.cbc, 'cbc:Name').txt(line.itemName).up();
    const classifiedTaxCategory = item.ele(NS.cac, 'cac:ClassifiedTaxCategory');
    classifiedTaxCategory.ele(NS.cbc, 'cbc:ID').txt('S').up();
    classifiedTaxCategory.ele(NS.cbc, 'cbc:Percent').txt(String(line.taxPercent)).up();
    classifiedTaxCategory.ele(NS.cac, 'cac:TaxScheme').ele(NS.cbc, 'cbc:ID').txt('VAT').up().up();
    classifiedTaxCategory.up();
    item.up();
    const price = invoiceLine.ele(NS.cac, 'cac:Price');
    price.ele(NS.cbc, 'cbc:PriceAmount', { currencyID: 'SAR' }).txt(line.unitPrice.toFixed(2)).up();
    price.up();
    invoiceLine.up();
  }

  return doc.end({ prettyPrint: false });
}
