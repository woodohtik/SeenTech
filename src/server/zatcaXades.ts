import crypto from 'crypto';
import { create } from 'xmlbuilder2';

/**
 * seen-readiness-fixes-task.md P2.1 (ZATCA-02, ZATCA-09, ZATCA-12) -- the
 * pieces of ZATCA's signing algorithm ("Security Features Implementation
 * Standards" / the e-invoicing developer guide):
 *
 *  1. invoice hash: drop ext:UBLExtensions, cac:Signature and the QR
 *     cac:AdditionalDocumentReference, canonicalize (C14N 1.1 -- the same
 *     bytes as 1.0 for a document without xml:id/xml:base), SHA-256, base64;
 *  2. the signature: ECDSA secp256k1 over those hash bytes, DER, base64;
 *  3. the certificate digest and the SignedProperties digest: SHA-256 as
 *     HEX, then base64 of that hex text (ZATCA's own convention);
 *  4. the Phase 2 QR: TLV tags 1-9, one base64 string with no line breaks.
 *
 * NOT YET CHECKED against ZATCA's SDK validator or its sandbox -- see
 * docs/zatca/compliance-run.md. What the tests prove: the hash is the same
 * whether computed before the signature block exists or from the finished
 * document, the signature verifies with the certificate's key, and the QR
 * carries the exact values of the XML.
 */

export const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';
export const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

/** PIH of a shop's first document: base64 of the hex SHA-256 of "0". */
export const ZATCA_FIRST_PIH = Buffer.from(crypto.createHash('sha256').update('0').digest('hex')).toString('base64');

// --- Canonical XML -------------------------------------------------------------

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  .replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');

type Mode = {
  /** 'inclusive' = C14N (every namespace in scope); 'exclusive' = only the namespaces each element uses. */
  ns: 'inclusive' | 'exclusive';
  /** Write an empty element as <a/> (how ZATCA's validator writes SignedProperties) instead of <a></a>. */
  selfClose?: boolean;
  skip?: (el: any) => boolean;
};

function declaredNs(el: any): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of Array.from(el.attributes || []) as any[]) {
    if (a.namespaceURI === XMLNS) m.set(a.prefix ? a.localName : '', a.value);
  }
  return m;
}

function inScopeNs(el: any): Map<string, string> {
  const chain: any[] = [];
  for (let n = el; n && n.nodeType === 1; n = n.parentNode) chain.unshift(n);
  const m = new Map<string, string>();
  for (const n of chain) for (const [p, u] of declaredNs(n)) m.set(p, u);
  return m;
}

function serialize(el: any, mode: Mode, rendered: Map<string, string>, scope: Map<string, string>): string {
  const own = declaredNs(el);
  const nsInScope = new Map(scope);
  for (const [p, u] of own) nsInScope.set(p, u);

  const attrs = (Array.from(el.attributes || []) as any[]).filter((a) => a.namespaceURI !== XMLNS);
  let wanted: Array<[string, string]>;
  if (mode.ns === 'inclusive') {
    wanted = [...nsInScope.entries()];
  } else {
    const used = new Set<string>([el.prefix || '']);
    for (const a of attrs) if (a.prefix) used.add(a.prefix);
    wanted = [...used].filter((p) => nsInScope.has(p) || p === '').map((p) => [p, nsInScope.get(p) ?? el.namespaceURI ?? ''] as [string, string]);
  }
  const toRender = wanted
    .filter(([p, u]) => !(p === '' && u === '' && !rendered.has('')) && rendered.get(p) !== u)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const nextRendered = new Map(rendered);
  for (const [p, u] of toRender) nextRendered.set(p, u);

  const sortedAttrs = attrs.slice().sort((a, b) => {
    const ka = `${a.namespaceURI || ''}\u0000${a.localName}`;
    const kb = `${b.namespaceURI || ''}\u0000${b.localName}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  let out = `<${el.nodeName}`;
  for (const [p, u] of toRender) out += p ? ` xmlns:${p}="${escAttr(u)}"` : ` xmlns="${escAttr(u)}"`;
  for (const a of sortedAttrs) out += ` ${a.name}="${escAttr(a.value)}"`;

  let inner = '';
  for (const c of Array.from(el.childNodes) as any[]) {
    if (c.nodeType === 1) {
      if (mode.skip?.(c)) continue;
      inner += serialize(c, mode, nextRendered, nsInScope);
    } else if (c.nodeType === 3 || c.nodeType === 4) {
      inner += escText(c.data);
    }
  }
  if (!inner && mode.selfClose) return `${out}/>`;
  return `${out}>${inner}</${el.nodeName}>`;
}

/** Canonical form of `el` (inclusive or exclusive), as a standalone subtree. */
export function canonicalize(el: any, mode: Mode): string {
  return serialize(el, mode, new Map(), el.parentNode?.nodeType === 1 ? inScopeNs(el.parentNode) : new Map());
}

const parseRoot = (xml: string): any => create(xml).root().node;

function childText(el: any, localName: string): string | null {
  for (const c of Array.from(el.childNodes) as any[]) if (c.nodeType === 1 && c.localName === localName) return c.textContent;
  return null;
}

/** The three parts ZATCA's transforms take out before hashing. */
export function isExcludedFromHash(el: any): boolean {
  if (el.localName === 'UBLExtensions') return true;
  if (el.localName === 'Signature' && el.prefix === 'cac') return true;
  if (el.localName === 'AdditionalDocumentReference' && childText(el, 'ID') === 'QR') return true;
  return false;
}

/** The invoice hash (base64 of the SHA-256 of the canonical document without the excluded parts). */
export function zatcaInvoiceHash(xml: string): string {
  const root = parseRoot(xml);
  const c14n = serialize(root, { ns: 'inclusive', skip: isExcludedFromHash }, new Map(), new Map());
  return crypto.createHash('sha256').update(c14n, 'utf8').digest('base64');
}

/** The canonical bytes the invoice hash is taken over (for tests and debugging). */
export function zatcaHashInput(xml: string): string {
  return serialize(parseRoot(xml), { ns: 'inclusive', skip: isExcludedFromHash }, new Map(), new Map());
}

const hexThenBase64 = (data: string) => Buffer.from(crypto.createHash('sha256').update(data, 'utf8').digest('hex')).toString('base64');

// --- Certificate -----------------------------------------------------------------

export type ZatcaCertificate = {
  /** The certificate's base64 DER (the body of the PEM), as written in ds:X509Certificate. */
  base64: string;
  digest: string;
  issuerName: string;
  serialNumber: string;
  publicKeyDer: Buffer;
  /** The issuer's signature over the certificate (QR tag 9). */
  signature: Buffer;
};

/** Accepts a PEM, a base64 DER, or ZATCA's binarySecurityToken (base64 of the base64 DER). */
export function readZatcaCertificate(input: string): ZatcaCertificate {
  let body = input.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  const once = Buffer.from(body, 'base64').toString('latin1');
  if (/^MII[A-Za-z0-9+/=]+$/.test(once)) body = once; // ZATCA's token wraps the base64 once more
  const der = Buffer.from(body, 'base64');
  const x509 = new crypto.X509Certificate(der);
  return {
    base64: body,
    digest: hexThenBase64(body),
    issuerName: x509.issuer.split('\n').reverse().join(', '),
    serialNumber: BigInt(`0x${x509.serialNumber}`).toString(10),
    publicKeyDer: x509.publicKey.export({ type: 'spki', format: 'der' }) as Buffer,
    signature: certificateSignature(der),
  };
}

/** Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue BIT STRING } */
function certificateSignature(der: Buffer): Buffer {
  const read = (buf: Buffer, at: number) => {
    let len = buf[at + 1];
    let head = 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | buf[at + 2 + i];
      head = 2 + n;
    }
    return { tag: buf[at], start: at + head, end: at + head + len };
  };
  const outer = read(der, 0);
  const tbs = read(der, outer.start);
  const alg = read(der, tbs.end);
  const sig = read(der, alg.end);
  if (sig.tag !== 0x03) throw new Error('certificate signature not found');
  return der.subarray(sig.start + 1, sig.end); // skip the unused-bits byte
}

// --- SignedProperties and the signature -----------------------------------------------

export type SignedPropertiesInput = { signingTime: string; certificate: ZatcaCertificate };

/**
 * The SignedProperties element exactly as ZATCA's validator writes it when it
 * checks the digest: each namespace declared where it is first used, empty
 * elements self-closed, no whitespace (the document itself has none).
 */
export function signedPropertiesForDigest(p: SignedPropertiesInput): string {
  const ds = ` xmlns:ds="${NS_DS}"`;
  return `<xades:SignedProperties xmlns:xades="${NS_XADES}" Id="xadesSignedProperties">`
    + `<xades:SignedSignatureProperties><xades:SigningTime>${escText(p.signingTime)}</xades:SigningTime>`
    + `<xades:SigningCertificate><xades:Cert><xades:CertDigest>`
    + `<ds:DigestMethod${ds} Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>`
    + `<ds:DigestValue${ds}>${p.certificate.digest}</ds:DigestValue>`
    + `</xades:CertDigest><xades:IssuerSerial>`
    + `<ds:X509IssuerName${ds}>${escText(p.certificate.issuerName)}</ds:X509IssuerName>`
    + `<ds:X509SerialNumber${ds}>${p.certificate.serialNumber}</ds:X509SerialNumber>`
    + `</xades:IssuerSerial></xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties></xades:SignedProperties>`;
}

export const signedPropertiesDigest = (p: SignedPropertiesInput) => hexThenBase64(signedPropertiesForDigest(p));

/** The SignedProperties of a finished document, re-written the way the validator does. */
export function signedPropertiesInDocument(xml: string): string | null {
  const root = parseRoot(xml);
  const find = (el: any): any => {
    if (el.localName === 'SignedProperties' && el.namespaceURI === NS_XADES) return el;
    for (const c of Array.from(el.childNodes) as any[]) if (c.nodeType === 1) { const f = find(c); if (f) return f; }
    return null;
  };
  const sp = find(root);
  return sp ? serialize(sp, { ns: 'exclusive', selfClose: true }, new Map(), inScopeNs(sp.parentNode)) : null;
}

/** ECDSA (secp256k1, SHA-256) over the invoice hash's bytes, DER, base64. */
export function signInvoiceHash(invoiceHashBase64: string, privateKeyPem: string): string {
  return crypto.sign('sha256', Buffer.from(invoiceHashBase64, 'base64'), privateKeyPem).toString('base64');
}

export function verifyInvoiceHashSignature(invoiceHashBase64: string, signatureBase64: string, certificate: ZatcaCertificate): boolean {
  try {
    const key = crypto.createPublicKey({ key: certificate.publicKeyDer, format: 'der', type: 'spki' });
    return crypto.verify('sha256', Buffer.from(invoiceHashBase64, 'base64'), key, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

// --- Phase 2 QR ------------------------------------------------------------------------

export type ZatcaQrInput = {
  sellerName: string;
  vatNumber: string;
  /** IssueDate + 'T' + IssueTime, as in the XML. */
  timestamp: string;
  total: string;
  vatTotal: string;
  invoiceHash: string;
  signature: string;
  certificate: ZatcaCertificate;
  /** Tag 9 (the certificate's own signature) is for simplified documents. */
  simplified: boolean;
};

function tlv(tag: number, value: Buffer): Buffer {
  if (value.length > 255) throw new Error(`QR tag ${tag} is longer than 255 bytes`);
  return Buffer.concat([Buffer.from([tag, value.length]), value]);
}

export function zatcaPhase2Qr(q: ZatcaQrInput): string {
  const parts = [
    tlv(1, Buffer.from(q.sellerName, 'utf8')),
    tlv(2, Buffer.from(q.vatNumber, 'utf8')),
    tlv(3, Buffer.from(q.timestamp, 'utf8')),
    tlv(4, Buffer.from(q.total, 'utf8')),
    tlv(5, Buffer.from(q.vatTotal, 'utf8')),
    tlv(6, Buffer.from(q.invoiceHash, 'utf8')),
    tlv(7, Buffer.from(q.signature, 'utf8')),
    tlv(8, q.certificate.publicKeyDer),
  ];
  if (q.simplified) parts.push(tlv(9, q.certificate.signature));
  return Buffer.concat(parts).toString('base64'); // Buffer's base64 never wraps lines
}

/** Reads a QR back into its tags (tests, and the QR ZATCA returns on a cleared invoice). */
export function readQrTags(qrBase64: string): Map<number, Buffer> {
  const buf = Buffer.from(qrBase64, 'base64');
  const tags = new Map<number, Buffer>();
  for (let i = 0; i + 1 < buf.length;) {
    const tag = buf[i];
    const len = buf[i + 1];
    tags.set(tag, buf.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return tags;
}

/** The QR inside a document (e.g. the invoice ZATCA hands back after clearance). */
export function qrFromDocument(xml: string): string | null {
  const root = parseRoot(xml);
  for (const c of Array.from(root.childNodes) as any[]) {
    if (c.nodeType === 1 && c.localName === 'AdditionalDocumentReference' && childText(c, 'ID') === 'QR') {
      const attachment = (Array.from(c.childNodes) as any[]).find((n) => n.nodeType === 1 && n.localName === 'Attachment');
      const value = attachment ? childText(attachment, 'EmbeddedDocumentBinaryObject') : null;
      return value ? value.replace(/\s+/g, '') : null;
    }
  }
  return null;
}
