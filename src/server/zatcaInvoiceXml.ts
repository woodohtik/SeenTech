import { create } from 'xmlbuilder2';
import {
  NS_DS, NS_XADES, ZatcaCertificate, signInvoiceHash, signedPropertiesDigest, zatcaInvoiceHash, zatcaPhase2Qr,
} from './zatcaXades';

/**
 * seen-readiness-fixes-task.md P2.1 (ZATCA-02, ZATCA-03, ZATCA-10, ZATCA-11)
 * -- the UBL 2.1 document ZATCA Phase 2 expects, for a tax invoice (388), a
 * credit note (381) or a debit note (383), simplified (B2C, reported) or
 * standard (B2B, cleared):
 *
 *   ext:UBLExtensions (XAdES signature) . ProfileID . ID . UUID . IssueDate .
 *   IssueTime . InvoiceTypeCode . DocumentCurrencyCode . TaxCurrencyCode .
 *   BillingReference (notes) . AdditionalDocumentReference ICV, PIH, QR
 *   (simplified) . cac:Signature . supplier . customer . Delivery (standard) .
 *   PaymentMeans (+ InstructionNote, the reason of a note) . TaxTotal twice .
 *   LegalMonetaryTotal . InvoiceLine...
 *
 * The amounts come from the document's own fixed lines (P1's one tax engine,
 * snapshotted at issue): every line already carries its share of any discount,
 * so the lines add up to the header and no document-level AllowanceCharge is
 * written. Written compact (no whitespace between elements): ZATCA hashes the
 * document after removing the signature parts, and whitespace left behind is
 * the classic cause of a hash mismatch.
 *
 * NOT YET CHECKED against ZATCA's SDK validator or its sandbox -- see
 * docs/zatca/compliance-run.md.
 */

export type ZatcaTaxCategory = 'S' | 'Z' | 'E' | 'O';

export interface ZatcaInvoiceLine {
  id: string;
  itemName: string;
  quantity: number;
  /** UN/ECE unit (MTR / YRD for fabric sold by length); PCE when absent. */
  unitCode?: string;
  /** The line's net as charged (after its share of any discount). */
  lineExtensionAmount: number;
  taxAmount: number;
  /** VAT rate as a percentage, e.g. 15. */
  taxPercent: number;
  /** S standard; O not subject to VAT (an item the shop marks exempt). Defaults from the rate. */
  taxCategory?: ZatcaTaxCategory;
}

export interface ZatcaParty {
  legalName: string;
  vatNumber: string;
  crn?: string;
  street?: string;
  buildingNumber?: string;
  district?: string;
  city?: string;
  postalCode?: string;
  countryCode?: string;
}

export interface ZatcaDocumentInput {
  type: 'invoice' | 'credit_note' | 'debit_note';
  simplified: boolean;
  invoiceNumber: string;
  uuid: string;
  /** "YYYY-MM-DD" and "HH:MM:SS", fixed when the document was issued. */
  issueDate: string;
  issueTime: string;
  /** Invoice counter value: the shop's documents numbered 1, 2, 3... with no gap. */
  icv: number;
  /** The previous document's hash; ZATCA_FIRST_PIH for the first. */
  pih: string;
  seller: ZatcaParty;
  buyer?: ZatcaParty;
  paymentMeansCode: string;
  /** Standard documents: the supply date (defaults to the issue date). */
  deliveryDate?: string;
  /** Credit / debit notes: the original invoice's number, and why the note was issued. */
  billingReference?: string;
  reason?: string;
  lines: ZatcaInvoiceLine[];
}

export type ZatcaSignature = {
  certificate: ZatcaCertificate;
  /** "YYYY-MM-DDTHH:MM:SS" */
  signingTime: string;
  invoiceHash: string;
  signature: string;
  qr?: string;
};

export const NS = {
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  sig: 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2',
  sac: 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2',
  sbc: 'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2',
};

const TYPE_CODE = { invoice: '388', credit_note: '381', debit_note: '383' } as const;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => r2(n).toFixed(2);
/** A unit price: as many decimals as it takes (up to 6) for quantity x price to be the line. */
function unitPrice(net: number, qty: number): string {
  const p = net / qty;
  for (let d = 2; d <= 6; d++) if (Math.abs(Number(p.toFixed(d)) * qty - net) < 0.005) return p.toFixed(d);
  return p.toFixed(6);
}
const pct = (n: number) => String(r2(n));
const categoryOf = (l: ZatcaInvoiceLine): ZatcaTaxCategory => l.taxCategory ?? (l.taxPercent > 0 ? 'S' : 'O');
// An item the shop marks exempt is reported as not subject to VAT; the exact
// exemption code (VATEX-SA-...) is for the founder's tax adviser to confirm.
const EXEMPTION: Partial<Record<ZatcaTaxCategory, { code: string; reason: string }>> = {
  O: { code: 'VATEX-SA-OOS', reason: 'Not subject to VAT' },
};

export type ZatcaTotals = { lineExtension: number; tax: number; taxInclusive: number };
export function zatcaTotals(lines: ZatcaInvoiceLine[]): ZatcaTotals {
  const lineExtension = r2(lines.reduce((s, l) => s + r2(l.lineExtensionAmount), 0));
  const tax = r2(lines.reduce((s, l) => s + r2(l.taxAmount), 0));
  return { lineExtension, tax, taxInclusive: r2(lineExtension + tax) };
}

function party(parent: any, p: ZatcaParty, isSeller: boolean) {
  const node = parent.ele(NS.cac, 'cac:Party');
  if (isSeller && p.crn) node.ele(NS.cac, 'cac:PartyIdentification').ele(NS.cbc, 'cbc:ID', { schemeID: 'CRN' }).txt(p.crn);
  const address = node.ele(NS.cac, 'cac:PostalAddress');
  if (p.street) address.ele(NS.cbc, 'cbc:StreetName').txt(p.street);
  if (p.buildingNumber) address.ele(NS.cbc, 'cbc:BuildingNumber').txt(p.buildingNumber);
  if (p.district) address.ele(NS.cbc, 'cbc:CitySubdivisionName').txt(p.district);
  if (p.city) address.ele(NS.cbc, 'cbc:CityName').txt(p.city);
  if (p.postalCode) address.ele(NS.cbc, 'cbc:PostalZone').txt(p.postalCode);
  address.ele(NS.cac, 'cac:Country').ele(NS.cbc, 'cbc:IdentificationCode').txt(p.countryCode || 'SA');
  if (p.vatNumber) {
    const scheme = node.ele(NS.cac, 'cac:PartyTaxScheme');
    scheme.ele(NS.cbc, 'cbc:CompanyID').txt(p.vatNumber);
    scheme.ele(NS.cac, 'cac:TaxScheme').ele(NS.cbc, 'cbc:ID').txt('VAT');
  }
  node.ele(NS.cac, 'cac:PartyLegalEntity').ele(NS.cbc, 'cbc:RegistrationName').txt(p.legalName);
}

function taxCategory(parent: any, name: 'cac:TaxCategory' | 'cac:ClassifiedTaxCategory', cat: ZatcaTaxCategory, percent: number, withReason: boolean) {
  const node = parent.ele(NS.cac, name);
  node.ele(NS.cbc, 'cbc:ID').txt(cat);
  node.ele(NS.cbc, 'cbc:Percent').txt(pct(percent));
  const ex = EXEMPTION[cat];
  if (withReason && ex) {
    node.ele(NS.cbc, 'cbc:TaxExemptionReasonCode').txt(ex.code);
    node.ele(NS.cbc, 'cbc:TaxExemptionReason').txt(ex.reason);
  }
  node.ele(NS.cac, 'cac:TaxScheme').ele(NS.cbc, 'cbc:ID').txt('VAT');
}

function ublExtensions(doc: any, s: ZatcaSignature) {
  const content = doc.ele(NS.ext, 'ext:UBLExtensions').ele(NS.ext, 'ext:UBLExtension');
  content.ele(NS.ext, 'ext:ExtensionURI').txt('urn:oasis:names:specification:ubl:dsig:enveloped:xades');
  const sigs = content.ele(NS.ext, 'ext:ExtensionContent')
    .ele(NS.sig, 'sig:UBLDocumentSignatures', { 'xmlns:sig': NS.sig, 'xmlns:sac': NS.sac, 'xmlns:sbc': NS.sbc });
  const info = sigs.ele(NS.sac, 'sac:SignatureInformation');
  info.ele(NS.cbc, 'cbc:ID').txt('urn:oasis:names:specification:ubl:signature:1');
  info.ele(NS.sbc, 'sbc:ReferencedSignatureID').txt('urn:oasis:names:specification:ubl:signature:Invoice');
  const sig = info.ele(NS_DS, 'ds:Signature', { 'xmlns:ds': NS_DS, Id: 'signature' });

  const signedInfo = sig.ele(NS_DS, 'ds:SignedInfo');
  signedInfo.ele(NS_DS, 'ds:CanonicalizationMethod', { Algorithm: 'http://www.w3.org/2006/12/xml-c14n11' });
  signedInfo.ele(NS_DS, 'ds:SignatureMethod', { Algorithm: 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256' });
  const ref = signedInfo.ele(NS_DS, 'ds:Reference', { Id: 'invoiceSignedData', URI: '' });
  const transforms = ref.ele(NS_DS, 'ds:Transforms');
  for (const xpath of [
    'not(//ancestor-or-self::ext:UBLExtensions)',
    'not(//ancestor-or-self::cac:Signature)',
    "not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])",
  ]) {
    transforms.ele(NS_DS, 'ds:Transform', { Algorithm: 'http://www.w3.org/TR/1999/REC-xpath-19991116' }).ele(NS_DS, 'ds:XPath').txt(xpath);
  }
  transforms.ele(NS_DS, 'ds:Transform', { Algorithm: 'http://www.w3.org/2006/12/xml-c14n11' });
  ref.ele(NS_DS, 'ds:DigestMethod', { Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' });
  ref.ele(NS_DS, 'ds:DigestValue').txt(s.invoiceHash);
  const propsRef = signedInfo.ele(NS_DS, 'ds:Reference', { Type: 'http://www.w3.org/2000/09/xmldsig#SignatureProperties', URI: '#xadesSignedProperties' });
  propsRef.ele(NS_DS, 'ds:DigestMethod', { Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' });
  propsRef.ele(NS_DS, 'ds:DigestValue').txt(signedPropertiesDigest({ signingTime: s.signingTime, certificate: s.certificate }));

  sig.ele(NS_DS, 'ds:SignatureValue').txt(s.signature);
  sig.ele(NS_DS, 'ds:KeyInfo').ele(NS_DS, 'ds:X509Data').ele(NS_DS, 'ds:X509Certificate').txt(s.certificate.base64);

  const props = sig.ele(NS_DS, 'ds:Object')
    .ele(NS_XADES, 'xades:QualifyingProperties', { 'xmlns:xades': NS_XADES, Target: 'signature' })
    .ele(NS_XADES, 'xades:SignedProperties', { Id: 'xadesSignedProperties' })
    .ele(NS_XADES, 'xades:SignedSignatureProperties');
  props.ele(NS_XADES, 'xades:SigningTime').txt(s.signingTime);
  const cert = props.ele(NS_XADES, 'xades:SigningCertificate').ele(NS_XADES, 'xades:Cert');
  const digest = cert.ele(NS_XADES, 'xades:CertDigest');
  digest.ele(NS_DS, 'ds:DigestMethod', { Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' });
  digest.ele(NS_DS, 'ds:DigestValue').txt(s.certificate.digest);
  const serial = cert.ele(NS_XADES, 'xades:IssuerSerial');
  serial.ele(NS_DS, 'ds:X509IssuerName').txt(s.certificate.issuerName);
  serial.ele(NS_DS, 'ds:X509SerialNumber').txt(s.certificate.serialNumber);
}

/** The document, signed when `signature` is given (unsigned: what the hash is taken over). */
export function buildZatcaDocument(input: ZatcaDocumentInput, signature?: ZatcaSignature): string {
  if (!input.lines.length) throw new Error('a ZATCA document needs at least one line');
  if (input.type !== 'invoice' && (!input.billingReference || !input.reason)) {
    throw new Error('a credit or debit note needs the original invoice number and a reason');
  }
  const totals = zatcaTotals(input.lines);
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele(NS.invoice, 'Invoice', { 'xmlns:cac': NS.cac, 'xmlns:cbc': NS.cbc, 'xmlns:ext': NS.ext });

  if (signature) ublExtensions(doc, signature);
  doc.ele(NS.cbc, 'cbc:ProfileID').txt('reporting:1.0');
  doc.ele(NS.cbc, 'cbc:ID').txt(input.invoiceNumber);
  doc.ele(NS.cbc, 'cbc:UUID').txt(input.uuid);
  doc.ele(NS.cbc, 'cbc:IssueDate').txt(input.issueDate);
  doc.ele(NS.cbc, 'cbc:IssueTime').txt(input.issueTime);
  doc.ele(NS.cbc, 'cbc:InvoiceTypeCode', { name: input.simplified ? '0200000' : '0100000' }).txt(TYPE_CODE[input.type]);
  doc.ele(NS.cbc, 'cbc:DocumentCurrencyCode').txt('SAR');
  doc.ele(NS.cbc, 'cbc:TaxCurrencyCode').txt('SAR');
  if (input.billingReference) {
    doc.ele(NS.cac, 'cac:BillingReference').ele(NS.cac, 'cac:InvoiceDocumentReference').ele(NS.cbc, 'cbc:ID').txt(input.billingReference);
  }
  const icv = doc.ele(NS.cac, 'cac:AdditionalDocumentReference');
  icv.ele(NS.cbc, 'cbc:ID').txt('ICV');
  icv.ele(NS.cbc, 'cbc:UUID').txt(String(input.icv));
  const pih = doc.ele(NS.cac, 'cac:AdditionalDocumentReference');
  pih.ele(NS.cbc, 'cbc:ID').txt('PIH');
  pih.ele(NS.cac, 'cac:Attachment').ele(NS.cbc, 'cbc:EmbeddedDocumentBinaryObject', { mimeCode: 'text/plain' }).txt(input.pih);
  if (signature?.qr) {
    const qr = doc.ele(NS.cac, 'cac:AdditionalDocumentReference');
    qr.ele(NS.cbc, 'cbc:ID').txt('QR');
    qr.ele(NS.cac, 'cac:Attachment').ele(NS.cbc, 'cbc:EmbeddedDocumentBinaryObject', { mimeCode: 'text/plain' }).txt(signature.qr);
  }
  const sigRef = doc.ele(NS.cac, 'cac:Signature');
  sigRef.ele(NS.cbc, 'cbc:ID').txt('urn:oasis:names:specification:ubl:signature:Invoice');
  sigRef.ele(NS.cbc, 'cbc:SignatureMethod').txt('urn:oasis:names:specification:ubl:dsig:enveloped:xades');

  party(doc.ele(NS.cac, 'cac:AccountingSupplierParty'), input.seller, true);
  if (input.buyer) party(doc.ele(NS.cac, 'cac:AccountingCustomerParty'), input.buyer, false);
  else doc.ele(NS.cac, 'cac:AccountingCustomerParty');
  if (!input.simplified) doc.ele(NS.cac, 'cac:Delivery').ele(NS.cbc, 'cbc:ActualDeliveryDate').txt(input.deliveryDate || input.issueDate);

  const means = doc.ele(NS.cac, 'cac:PaymentMeans');
  means.ele(NS.cbc, 'cbc:PaymentMeansCode').txt(input.paymentMeansCode);
  if (input.type !== 'invoice') means.ele(NS.cbc, 'cbc:InstructionNote').txt(input.reason!);

  doc.ele(NS.cac, 'cac:TaxTotal').ele(NS.cbc, 'cbc:TaxAmount', { currencyID: 'SAR' }).txt(money(totals.tax));
  const taxTotal = doc.ele(NS.cac, 'cac:TaxTotal');
  taxTotal.ele(NS.cbc, 'cbc:TaxAmount', { currencyID: 'SAR' }).txt(money(totals.tax));
  const groups = new Map<string, { cat: ZatcaTaxCategory; percent: number; net: number; tax: number }>();
  for (const l of input.lines) {
    const cat = categoryOf(l);
    const key = `${cat}:${l.taxPercent}`;
    const g = groups.get(key) ?? { cat, percent: cat === 'S' ? l.taxPercent : 0, net: 0, tax: 0 };
    g.net = r2(g.net + r2(l.lineExtensionAmount));
    g.tax = r2(g.tax + r2(l.taxAmount));
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const sub = taxTotal.ele(NS.cac, 'cac:TaxSubtotal');
    sub.ele(NS.cbc, 'cbc:TaxableAmount', { currencyID: 'SAR' }).txt(money(g.net));
    sub.ele(NS.cbc, 'cbc:TaxAmount', { currencyID: 'SAR' }).txt(money(g.tax));
    taxCategory(sub, 'cac:TaxCategory', g.cat, g.percent, true);
  }

  const total = doc.ele(NS.cac, 'cac:LegalMonetaryTotal');
  total.ele(NS.cbc, 'cbc:LineExtensionAmount', { currencyID: 'SAR' }).txt(money(totals.lineExtension));
  total.ele(NS.cbc, 'cbc:TaxExclusiveAmount', { currencyID: 'SAR' }).txt(money(totals.lineExtension));
  total.ele(NS.cbc, 'cbc:TaxInclusiveAmount', { currencyID: 'SAR' }).txt(money(totals.taxInclusive));
  total.ele(NS.cbc, 'cbc:AllowanceTotalAmount', { currencyID: 'SAR' }).txt('0.00');
  total.ele(NS.cbc, 'cbc:PrepaidAmount', { currencyID: 'SAR' }).txt('0.00');
  total.ele(NS.cbc, 'cbc:PayableAmount', { currencyID: 'SAR' }).txt(money(totals.taxInclusive));

  for (const l of input.lines) {
    const qty = l.quantity > 0 ? l.quantity : 1;
    const line = doc.ele(NS.cac, 'cac:InvoiceLine');
    line.ele(NS.cbc, 'cbc:ID').txt(l.id);
    line.ele(NS.cbc, 'cbc:InvoicedQuantity', { unitCode: l.unitCode || 'PCE' }).txt(String(qty));
    line.ele(NS.cbc, 'cbc:LineExtensionAmount', { currencyID: 'SAR' }).txt(money(l.lineExtensionAmount));
    const lineTax = line.ele(NS.cac, 'cac:TaxTotal');
    lineTax.ele(NS.cbc, 'cbc:TaxAmount', { currencyID: 'SAR' }).txt(money(l.taxAmount));
    lineTax.ele(NS.cbc, 'cbc:RoundingAmount', { currencyID: 'SAR' }).txt(money(r2(l.lineExtensionAmount) + r2(l.taxAmount)));
    const item = line.ele(NS.cac, 'cac:Item');
    item.ele(NS.cbc, 'cbc:Name').txt(l.itemName);
    const cat = categoryOf(l);
    taxCategory(item, 'cac:ClassifiedTaxCategory', cat, cat === 'S' ? l.taxPercent : 0, false);
    line.ele(NS.cac, 'cac:Price').ele(NS.cbc, 'cbc:PriceAmount', { currencyID: 'SAR' }).txt(unitPrice(r2(l.lineExtensionAmount), qty));
  }

  return doc.end({ prettyPrint: false });
}

export type SignedZatcaDocument = { xml: string; invoiceHash: string; signature: string; qr: string | null };

/** Hash, sign, add the QR (simplified) and the XAdES block; the hash is checked again on the result. */
export function signZatcaDocument(
  input: ZatcaDocumentInput,
  key: { privateKeyPem: string; certificate: ZatcaCertificate; signingTime: string },
): SignedZatcaDocument {
  const invoiceHash = zatcaInvoiceHash(buildZatcaDocument(input));
  const signature = signInvoiceHash(invoiceHash, key.privateKeyPem);
  const totals = zatcaTotals(input.lines);
  const qr = input.simplified
    ? zatcaPhase2Qr({
      sellerName: input.seller.legalName,
      vatNumber: input.seller.vatNumber,
      timestamp: `${input.issueDate}T${input.issueTime}`,
      total: money(totals.taxInclusive),
      vatTotal: money(totals.tax),
      invoiceHash,
      signature,
      certificate: key.certificate,
      simplified: true,
    })
    : null;
  const xml = buildZatcaDocument(input, {
    certificate: key.certificate, signingTime: key.signingTime, invoiceHash, signature, qr: qr ?? undefined,
  });
  if (zatcaInvoiceHash(xml) !== invoiceHash) throw new Error('ZATCA invoice hash changed after signing');
  return { xml, invoiceHash, signature, qr };
}
