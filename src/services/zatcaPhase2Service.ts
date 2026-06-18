/**
 * zatcaPhase2Service — سكافولد المرحلة الثانية (الربط/التكامل) لفوترة زاتكا
 * =========================================================================
 * المرحلة الأولى (الموجودة في zatcaService.ts) تنتج رمز QR فقط.
 * المرحلة الثانية تتطلّب: فاتورة UBL 2.1 XML + تسلسل هاش (PIH) + ختم تشفيري (ECDSA)
 * + إرسال لخوادم زاتكا (Clearance للـ B2B / Reporting للـ B2C).
 *
 * هذا «سكافولد»: البنية والأجزاء الحتمية (XML، الهاش، التسلسل، عميل الـAPI) جاهزة،
 * والأماكن التي تحتاج شهادتك (CSID) والتوقيع والاعتماد مُعلَّمة بـ TODO(ZATCA).
 * لا تُستخدم في الإنتاج قبل الاختبار على ساندبوكس زاتكا. تفاصيل الربط في
 * ZATCA_PHASE2_SCAFFOLD.md.
 *
 * مراجع: ZATCA E-Invoicing (FATOORA) — UBL 2.1, EN 16931, security standards.
 */

// ---------- مدخلات منظّمة (غير مقترنة بأنواع التطبيق الداخلية) ----------
export interface ZatcaLineItem {
  name: string;
  quantity: number;
  unitPrice: number;     // قبل الضريبة
  vatRate: number;       // مثال: 15
}
export interface ZatcaSeller {
  legalName: string;
  vatNumber: string;     // 15 رقم
  crNumber?: string;     // السجل التجاري
  address: { street: string; building: string; city: string; postalCode: string; district: string; countryCode: string };
}
export interface ZatcaBuyer {
  name?: string;
  vatNumber?: string;    // مطلوب لفواتير B2B (Standard)
}
export interface ZatcaInvoiceInput {
  invoiceNumber: string;
  uuid: string;                 // UUID v4 لكل فاتورة
  issueDateTime: string;        // ISO 8601
  invoiceType: 'standard' | 'simplified'; // standard=B2B (Clearance) / simplified=B2C (Reporting)
  seller: ZatcaSeller;
  buyer?: ZatcaBuyer;
  lines: ZatcaLineItem[];
  previousInvoiceHash: string;  // PIH — هاش الفاتورة السابقة (أو قيمة البداية "0" base64)
}

export interface ZatcaInvoiceResult {
  xml: string;
  invoiceHash: string;          // base64(SHA-256) — يصبح PIH للفاتورة التالية
  qrBase64?: string;            // يُملأ بعد التوقيع
}

// ---------- 1) توليد UBL 2.1 XML ----------
/**
 * يبني فاتورة UBL 2.1 مبسّطة الهيكل (العناصر الجوهرية لزاتكا).
 * TODO(ZATCA): أكمل العناصر الإلزامية الكاملة وفق دليل زاتكا (AllowanceCharge,
 * TaxSubtotal لكل فئة، PaymentMeans، InvoiceTypeCode subtype...) قبل الاعتماد.
 */
export function buildUblXml(inv: ZatcaInvoiceInput): string {
  const totals = computeTotals(inv.lines);
  const typeCode = inv.invoiceType === 'standard' ? '388' : '388';
  // 0100000 = standard, 0200000 = simplified (name attribute في زاتكا)
  const typeName = inv.invoiceType === 'standard' ? '0100000' : '0200000';

  const lineXml = inv.lines
    .map((l, i) => {
      const lineNet = (l.unitPrice * l.quantity).toFixed(2);
      const lineVat = (l.unitPrice * l.quantity * (l.vatRate / 100)).toFixed(2);
      return `
    <cac:InvoiceLine>
      <cbc:ID>${i + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="PCE">${l.quantity}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="SAR">${lineNet}</cbc:LineExtensionAmount>
      <cac:TaxTotal>
        <cbc:TaxAmount currencyID="SAR">${lineVat}</cbc:TaxAmount>
      </cac:TaxTotal>
      <cac:Item>
        <cbc:Name>${escapeXml(l.name)}</cbc:Name>
        <cac:ClassifiedTaxCategory>
          <cbc:ID>S</cbc:ID>
          <cbc:Percent>${l.vatRate.toFixed(2)}</cbc:Percent>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:ClassifiedTaxCategory>
      </cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="SAR">${l.unitPrice.toFixed(2)}</cbc:PriceAmount></cac:Price>
    </cac:InvoiceLine>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(inv.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${inv.uuid}</cbc:UUID>
  <cbc:IssueDate>${inv.issueDateTime.slice(0, 10)}</cbc:IssueDate>
  <cbc:IssueTime>${inv.issueDateTime.slice(11, 19)}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${typeName}">${typeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
  <!-- PIH: هاش الفاتورة السابقة (تسلسل السلسلة) -->
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${inv.previousInvoiceHash}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(inv.seller.address.street)}</cbc:StreetName>
        <cbc:BuildingNumber>${escapeXml(inv.seller.address.building)}</cbc:BuildingNumber>
        <cbc:CityName>${escapeXml(inv.seller.address.city)}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(inv.seller.address.postalCode)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${inv.seller.address.countryCode}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(inv.seller.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>${escapeXml(inv.seller.legalName)}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  ${inv.buyer ? buildBuyerXml(inv.buyer) : ''}
  <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${totals.vat.toFixed(2)}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="SAR">${totals.net.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="SAR">${totals.net.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">${totals.gross.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="SAR">${totals.gross.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lineXml}
</Invoice>`;
}

// ---------- 2) هاش الفاتورة + التسلسل (PIH) ----------
/**
 * يحسب base64(SHA-256) للـ XML — يصبح PIH للفاتورة التالية ويُستخدم في التوقيع.
 * TODO(ZATCA): زاتكا تتطلّب canonicalization محدّد (C14N) قبل الهاش، وحذف عناصر
 * UBLExtensions/Signature/QR من نطاق الهاش. طبّق التقنين الرسمي قبل الإنتاج.
 */
export async function computeInvoiceHash(xml: string): Promise<string> {
  const data = new TextEncoder().encode(xml);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64FromBytes(new Uint8Array(digest));
}

// ---------- 3) التوقيع التشفيري (ECDSA) ----------
export interface SignatureMaterial { csidCertificate: string; privateKeyPem: string; }
/**
 * TODO(ZATCA): التوقيع يتطلّب مفتاح CSID الخاص (secp256k1) وبنية UBLExtensions/
 * ds:Signature وفق معيار زاتكا، ثم بناء QR (TLV) الموسّع (يشمل الختم والمفتاح العام).
 * هذا الجزء لا يُبنى «أعمى» — يحتاج الشهادة واختبار الساندبوكس.
 */
export async function signInvoice(_xml: string, _material: SignatureMaterial): Promise<{ signedXml: string; qrBase64: string }> {
  throw new Error('TODO(ZATCA): implement ECDSA signing with your CSID. See ZATCA_PHASE2_SCAFFOLD.md §التوقيع.');
}

// ---------- 4) عميل API زاتكا (Compliance / Production / Clearance / Reporting) ----------
const ZATCA_BASE = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  // simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
};

export interface ZatcaCredentials { env: 'sandbox' | 'production'; binarySecurityToken: string; secret: string; }

/** Clearance — للفواتير المعيارية B2B (موافقة قبل التسليم). */
export async function clearInvoice(signedXmlBase64: string, invoiceHash: string, uuid: string, creds: ZatcaCredentials) {
  return zatcaPost(`${ZATCA_BASE[creds.env]}/invoices/clearance/single`, signedXmlBase64, invoiceHash, uuid, creds, { 'Clearance-Status': '1' });
}
/** Reporting — للفواتير المبسّطة B2C (إبلاغ خلال 24 ساعة). */
export async function reportInvoice(signedXmlBase64: string, invoiceHash: string, uuid: string, creds: ZatcaCredentials) {
  return zatcaPost(`${ZATCA_BASE[creds.env]}/invoices/reporting/single`, signedXmlBase64, invoiceHash, uuid, creds);
}

async function zatcaPost(url: string, invoiceB64: string, hash: string, uuid: string, creds: ZatcaCredentials, extra: Record<string, string> = {}) {
  // TODO(ZATCA): المصادقة Basic عبر binarySecurityToken:secret، والترويسات الرسمية.
  const auth = btoa(`${creds.binarySecurityToken}:${creds.secret}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept-Version': 'V2',
      'Authorization': `Basic ${auth}`,
      ...extra,
    },
    body: JSON.stringify({ invoiceHash: hash, uuid, invoice: invoiceB64 }),
  });
  if (!res.ok) throw new Error(`ZATCA ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------- التدفّق الكامل (مرجعي) ----------
/**
 * المثال المرجعي للتسلسل الكامل — يرمي عند خطوة التوقيع (TODO).
 */
export async function processPhase2Invoice(inv: ZatcaInvoiceInput, material: SignatureMaterial, creds: ZatcaCredentials): Promise<ZatcaInvoiceResult> {
  const xml = buildUblXml(inv);
  const invoiceHash = await computeInvoiceHash(xml);
  const { signedXml, qrBase64 } = await signInvoice(xml, material); // TODO(ZATCA)
  const signedB64 = base64FromBytes(new TextEncoder().encode(signedXml));
  if (inv.invoiceType === 'standard') await clearInvoice(signedB64, invoiceHash, inv.uuid, creds);
  else await reportInvoice(signedB64, invoiceHash, inv.uuid, creds);
  return { xml: signedXml, invoiceHash, qrBase64 };
}

// ---------- مساعدات ----------
function computeTotals(lines: ZatcaLineItem[]) {
  let net = 0, vat = 0;
  for (const l of lines) {
    const lineNet = l.unitPrice * l.quantity;
    net += lineNet;
    vat += lineNet * (l.vatRate / 100);
  }
  return { net, vat, gross: net + vat };
}
function buildBuyerXml(b: ZatcaBuyer): string {
  return `<cac:AccountingCustomerParty><cac:Party>
    ${b.vatNumber ? `<cac:PartyTaxScheme><cbc:CompanyID>${escapeXml(b.vatNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
    ${b.name ? `<cac:PartyLegalEntity><cbc:RegistrationName>${escapeXml(b.name)}</cbc:RegistrationName></cac:PartyLegalEntity>` : ''}
  </cac:Party></cac:AccountingCustomerParty>`;
}
function escapeXml(s: string): string {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
}
function base64FromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
