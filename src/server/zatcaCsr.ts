/**
 * ZATCA real onboarding (seen-zatca-real-onboarding-task.md), Phase ب step 1:
 * generates a real PKCS#10 Certificate Signing Request for ZATCA's
 * Compliance/Production CSID issuance -- the first piece of actual
 * "connection" code this project has ever had (everything before this was
 * either Phase 1 QR-only, or a scaffold that threw on purpose).
 *
 * No external PKI/ASN.1 package (node-forge, jsrsasign, @peculiar/x509...):
 * this project's existing ZATCA crypto code (zatcaSigning.ts, zatcaCrypto.ts)
 * deliberately uses only Node's built-in `crypto`, with zero new runtime
 * dependencies, so a CSR built in a Vercel serverless function never depends
 * on whether a system `openssl` binary happens to be present in that
 * container (not guaranteed, unlike Node's own statically-linked OpenSSL
 * used internally by the `crypto` module). This file hand-rolls just the
 * handful of ASN.1 DER primitives PKCS#10 actually needs.
 *
 * CONFIDENCE LEVELS (read before trusting any part of this against a real
 * ZATCA submission -- same convention as zatcaInvoiceXml.ts):
 *  - HIGH: the generic PKCS#10 CertificationRequest/CertificationRequestInfo
 *    structure, DER primitives, and the ECDSA-SHA256 self-signature over the
 *    CSR body. This is standard, stable, 30-year-old X.509/PKCS#10 --
 *    verified locally against OpenSSL's own CSR parser (`openssl req -text
 *    -noout -verify`) during development, not just against this file's own
 *    logic.
 *  - LOWER, ZATCA-SPECIFIC, NEEDS VALIDATION: the exact Subject DN field
 *    order/values (C/OU/O/CN) and the custom SubjectAltName directoryName
 *    extension (SN/UID/title/registeredAddress/businessCategory) ZATCA
 *    overlays on top of plain PKCS#10. Implemented here to match the
 *    structure used by ZATCA's own published OpenSSL CSR config examples
 *    and widely-used community ZATCA SDKs, but NOT yet checked against a
 *    real ZATCA Compliance CSID response -- that only happens the first
 *    time this is actually submitted to the Integration Sandbox (dummy VAT
 *    399999999900003, no real account needed). ZATCA's own CSID endpoint is
 *    the authoritative validator for this part, and will reject a malformed
 *    CSR with a specific error rather than silently accepting bad data --
 *    a safe failure mode, not a dangerous one.
 *
 * Sources: ZATCA's own "Onboarding e-Invoicing Solutions" CSR generation
 * guidance (OpenSSL config examples) and the request shape used by widely
 * referenced community ZATCA e-invoicing SDKs (Python/PHP/Node) for the
 * same CSR, cross-checked for internal consistency. No access to ZATCA's
 * private XSD/validation rules beyond what's publicly documented.
 */

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Minimal ASN.1 DER encoding primitives -- just enough for PKCS#10, nothing
// general-purpose. Each function returns a fully TLV-encoded (tag+length+
// value) DER buffer for that type.
// ---------------------------------------------------------------------------

function derLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let l = len;
  while (l > 0) {
    bytes.unshift(l & 0xff);
    l = Math.floor(l / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTLV(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSequence(...children: Buffer[]): Buffer {
  return derTLV(0x30, Buffer.concat(children));
}

function derSet(...children: Buffer[]): Buffer {
  return derTLV(0x31, Buffer.concat(children));
}

function derOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const bytes: number[] = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const chunk: number[] = [v & 0x7f];
    v = Math.floor(v / 128);
    while (v > 0) {
      chunk.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    bytes.push(...chunk);
  }
  return derTLV(0x06, Buffer.from(bytes));
}

function derIntegerSmall(n: number): Buffer {
  if (n === 0) return derTLV(0x02, Buffer.from([0x00]));
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  if (bytes[0] & 0x80) bytes.unshift(0x00);
  return derTLV(0x02, Buffer.from(bytes));
}

function derBitString(data: Buffer, unusedBits = 0): Buffer {
  return derTLV(0x03, Buffer.concat([Buffer.from([unusedBits]), data]));
}

function derOctetString(data: Buffer): Buffer {
  return derTLV(0x04, data);
}

function derUtf8String(s: string): Buffer {
  return derTLV(0x0c, Buffer.from(s, 'utf8'));
}

function derPrintableString(s: string): Buffer {
  return derTLV(0x13, Buffer.from(s, 'ascii'));
}

/** Context-specific tag, e.g. the [0] attributes field on CertificationRequestInfo. */
function derContext(tagNum: number, constructed: boolean, content: Buffer): Buffer {
  const tag = (constructed ? 0xa0 : 0x80) | tagNum;
  return derTLV(tag, content);
}

// ---------------------------------------------------------------------------
// X.509 attribute-type OIDs used in the subject DN and the SAN extension.
// ---------------------------------------------------------------------------

const OID = {
  countryName: '2.5.4.6',
  organizationName: '2.5.4.10',
  organizationalUnitName: '2.5.4.11',
  commonName: '2.5.4.3',
  serialNumber: '2.5.4.5',
  title: '2.5.4.12',
  registeredAddress: '2.5.4.26',
  businessCategory: '2.5.4.15',
  uid: '0.9.2342.19200300.100.1.1',
  subjectAltName: '2.5.29.17',
  keyUsage: '2.5.29.15',
  extensionRequest: '1.2.840.113549.1.9.14', // pkcs-9-at-extensionRequest
};

/** One RDN: SET { SEQUENCE { OID, Value } }. */
function rdn(oid: string, value: Buffer): Buffer {
  return derSet(derSequence(derOid(oid), value));
}

export interface ZatcaCsrSubject {
  /** ISO 3166-1 alpha-2, e.g. "SA". */
  countryCode: string;
  /** ZATCA's "Organization Unit Name" -- in practice the branch/business unit identifier. */
  organizationUnitName: string;
  /** The taxpayer's 15-digit VAT registration number. */
  organizationName: string;
  /**
   * EGS (E-invoice Generation Solution) Serial Number, ZATCA's required
   * format: "1-<Solution Name>|2-<Model>|3-<Serial Number>".
   */
  commonName: string;
  /** VAT registration number again, carried in the SAN's UID field (ZATCA repeats it there). */
  vatNumber: string;
  /** A unique identifier for this specific EGS unit (SAN's "SN" field). */
  egsSerialNumber: string;
  /**
   * 4-digit invoice-type support flag ZATCA reads from the SAN "title"
   * field: positions are (Tax[Standard], Simplified, reserved, reserved),
   * '1' = supported / '0' = not. "1100" = supports both standard (B2B) and
   * simplified (B2C) invoices -- this project issues both, so that's the
   * default.
   */
  invoiceTypeFlag?: string;
  /** Free-text business location, SAN "registeredAddress". */
  location: string;
  /** Free-text business activity description, SAN "businessCategory". */
  businessCategory: string;
}

function buildSubjectName(s: ZatcaCsrSubject): Buffer {
  return derSequence(
    rdn(OID.countryName, derPrintableString(s.countryCode)),
    rdn(OID.organizationalUnitName, derUtf8String(s.organizationUnitName)),
    rdn(OID.organizationName, derUtf8String(s.organizationName)),
    rdn(OID.commonName, derUtf8String(s.commonName))
  );
}

/** The ZATCA-specific SubjectAltName extension: a single directoryName GeneralName. */
function buildSanExtensionValue(s: ZatcaCsrSubject): Buffer {
  const dirName = derSequence(
    rdn(OID.serialNumber, derUtf8String(s.egsSerialNumber)),
    rdn(OID.uid, derUtf8String(s.vatNumber)),
    rdn(OID.title, derUtf8String(s.invoiceTypeFlag ?? '1100')),
    rdn(OID.registeredAddress, derUtf8String(s.location)),
    rdn(OID.businessCategory, derUtf8String(s.businessCategory))
  );
  // GeneralName ::= CHOICE { ... directoryName [4] Name ... } -- constructed context tag 4.
  const generalName = derContext(4, true, dirName);
  // GeneralNames ::= SEQUENCE OF GeneralName
  return derSequence(generalName);
}

function buildExtensions(s: ZatcaCsrSubject): Buffer {
  // keyUsage: digitalSignature (bit 0) + nonRepudiation (bit 1) set, critical.
  const keyUsageExt = derSequence(
    derOid(OID.keyUsage),
    Buffer.from([0x01, 0x01, 0xff]), // BOOLEAN TRUE (critical)
    derOctetString(derBitString(Buffer.from([0xc0]), 6))
  );
  const sanExt = derSequence(derOid(OID.subjectAltName), derOctetString(buildSanExtensionValue(s)));
  return derSequence(keyUsageExt, sanExt);
}

/** The PKCS#9 extensionRequest attribute, carrying the extensions above. */
function buildAttributes(s: ZatcaCsrSubject): Buffer {
  const extensionRequestAttr = derSequence(
    derOid(OID.extensionRequest),
    derSet(buildExtensions(s))
  );
  // attributes [0] IMPLICIT SET OF Attribute -- IMPLICIT means the [0] tag
  // itself carries the SET-of semantics; it must NOT additionally wrap an
  // explicit universal SET (0x31) tag inside, or OpenSSL's strict X509_REQ
  // ASN.1 template rejects the whole CSR with "wrong tag" (caught by
  // validating this module's output against `openssl req -verify` during
  // development -- a real, reproduced bug, not a hypothetical one).
  return derContext(0, true, extensionRequestAttr);
}

export interface ZatcaCsrResult {
  /** PEM-encoded PKCS#10 CSR ("-----BEGIN CERTIFICATE REQUEST-----..."), what ZATCA's CSID endpoints expect. */
  csrPem: string;
  /** The raw DER bytes, base64-encoded with no PEM headers -- some ZATCA onboarding flows want this form directly in the request body. */
  csrBase64: string;
}

/**
 * Builds and self-signs a PKCS#10 CSR for ZATCA CSID issuance, using an
 * EC secp256k1 key pair (the curve ZATCA's cryptographic stamp requires --
 * same curve as zatcaSigning.ts). The CSR's own self-signature uses
 * standard ASN.1 DER ECDSA encoding (crypto.sign's default) -- NOT the
 * XML-DSig ieee-p1363 format zatcaSigning.ts uses for invoice signatures;
 * those are two different signature contexts with different required
 * encodings, easy to mix up.
 */
export function generateZatcaCsr(subject: ZatcaCsrSubject, privateKeyPem: string, publicKeyPem: string): ZatcaCsrResult {
  const publicKey = crypto.createPublicKey(publicKeyPem);
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;

  const certificationRequestInfo = derSequence(
    derIntegerSmall(0), // version 0 (PKCS#10 v1)
    buildSubjectName(subject),
    spki,
    buildAttributes(subject)
  );

  // ecdsa-with-SHA256
  const signatureAlgorithm = derSequence(derOid('1.2.840.10045.4.3.2'));
  const signature = crypto.sign('sha256', certificationRequestInfo, { key: privateKeyPem }); // default DER encoding, correct for PKCS#10

  const certificationRequest = derSequence(
    certificationRequestInfo,
    signatureAlgorithm,
    derBitString(signature, 0)
  );

  const csrBase64 = certificationRequest.toString('base64');
  const pemBody = csrBase64.match(/.{1,64}/g)?.join('\n') ?? csrBase64;
  const csrPem = `-----BEGIN CERTIFICATE REQUEST-----\n${pemBody}\n-----END CERTIFICATE REQUEST-----\n`;

  return { csrPem, csrBase64 };
}
