import { describe, expect, it } from 'vitest';
import { generateTestKeyPair } from './zatcaSigning';
import { generateZatcaCsr, ZATCA_CSR_TEMPLATE, type ZatcaCsrSubject } from './zatcaCsr';

const testSubject: ZatcaCsrSubject = {
  countryCode: 'SA',
  organizationUnitName: 'Riyadh Branch',
  organizationName: 'Test Taxpayer LTD',
  commonName: 'Seen-test-egs-001',
  vatNumber: '399999999900003',
  egsSerialNumber: '1-Seen|2-SeenPOS|3-test-egs-001',
  location: 'Riyadh',
  businessCategory: 'Tailoring and Fabric Retail',
};

describe('generateZatcaCsr', () => {
  it('produces a PEM-wrapped CSR with the correct headers', () => {
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();
    const { csrPem } = generateZatcaCsr(testSubject, privateKeyPem, publicKeyPem);
    expect(csrPem).toMatch(/^-----BEGIN CERTIFICATE REQUEST-----\n/);
    expect(csrPem.trim()).toMatch(/-----END CERTIFICATE REQUEST-----$/);
  });

  it('produces DER bytes starting with a SEQUENCE tag', () => {
    // Structural, not semantic, verification -- this module's actual
    // correctness (valid PKCS#10, correct ZATCA subject/SAN fields, a
    // signature that verifies) was confirmed externally during development
    // via `openssl req -in <output> -text -noout -verify`
    // ("Certificate request self-signature verify OK"). Node has no
    // built-in CSR parser to assert that same thing in-process without
    // adding a new ASN.1 dependency this project deliberately avoids (see
    // this module's own header comment), so these tests check what's
    // checkable without one.
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();
    const { csrBase64 } = generateZatcaCsr(testSubject, privateKeyPem, publicKeyPem);
    const der = Buffer.from(csrBase64, 'base64');
    expect(der[0]).toBe(0x30); // SEQUENCE
  });

  it('embeds the ZATCA-specific subject and SAN fields as literal UTF-8 text in the DER', () => {
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();
    const { csrBase64 } = generateZatcaCsr(testSubject, privateKeyPem, publicKeyPem);
    const der = Buffer.from(csrBase64, 'base64').toString('latin1');
    expect(der).toContain(testSubject.commonName);
    expect(der).toContain(testSubject.vatNumber);
    expect(der).toContain(testSubject.egsSerialNumber);
    expect(der).toContain(testSubject.location);
    expect(der).toContain(testSubject.businessCategory);
    expect(der).toContain('1100'); // default invoiceTypeFlag
  });

  it('embeds the secp256k1 and ecdsa-with-SHA256 OIDs', () => {
    // 1.3.132.0.10 (secp256k1) and 1.2.840.10045.4.3.2 (ecdsa-with-SHA256),
    // DER-encoded -- a cheap, concrete way to catch "signed with the wrong
    // curve/algorithm" without a full parser.
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();
    const { csrBase64 } = generateZatcaCsr(testSubject, privateKeyPem, publicKeyPem);
    const der = Buffer.from(csrBase64, 'base64');
    const secp256k1Oid = Buffer.from([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a]);
    const ecdsaSha256Oid = Buffer.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
    expect(der.indexOf(secp256k1Oid)).toBeGreaterThan(-1);
    expect(der.indexOf(ecdsaSha256Oid)).toBeGreaterThan(-1);
  });

  it('produces a different signature for a different key pair over the same subject', () => {
    const pairA = generateTestKeyPair();
    const pairB = generateTestKeyPair();
    const csrA = generateZatcaCsr(testSubject, pairA.privateKeyPem, pairA.publicKeyPem);
    const csrB = generateZatcaCsr(testSubject, pairB.privateKeyPem, pairB.publicKeyPem);
    expect(csrA.csrBase64).not.toBe(csrB.csrBase64);
  });

  it('respects a custom invoiceTypeFlag instead of the default', () => {
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();
    const { csrBase64 } = generateZatcaCsr(
      { ...testSubject, invoiceTypeFlag: '1000' },
      privateKeyPem,
      publicKeyPem
    );
    const der = Buffer.from(csrBase64, 'base64').toString('latin1');
    expect(der).toContain('1000');
  });

  // seen-readiness-fixes-task.md P6 (ZATCA-05): the CSR follows ZATCA's own
  // template -- verified once by hand with `openssl req -verify -text`.
  const TEMPLATE_OID = Buffer.from([0x06, 0x09, 0x2b, 0x06, 0x01, 0x04, 0x01, 0x82, 0x37, 0x14, 0x02]); // 1.3.6.1.4.1.311.20.2
  const KEY_USAGE_OID = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x0f]); // 2.5.29.15
  const SAN_OID = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x11]); // 2.5.29.17

  it.each([
    ['sandbox', 'TSTZATCA-Code-Signing'],
    ['simulation', 'PREZATCA-Code-Signing'],
    ['production', 'ZATCA-Code-Signing'],
  ] as const)('carries the certificate template name of the %s environment', (environment, template) => {
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();
    const der = Buffer.from(generateZatcaCsr({ ...testSubject, environment }, privateKeyPem, publicKeyPem).csrBase64, 'base64');
    const at = der.indexOf(TEMPLATE_OID);
    expect(at).toBeGreaterThan(-1);
    // OCTET STRING { PrintableString(template) } right after the OID
    const value = Buffer.concat([Buffer.from([0x04, template.length + 2, 0x13, template.length]), Buffer.from(template, 'latin1')]);
    expect(der.subarray(at + TEMPLATE_OID.length, at + TEMPLATE_OID.length + value.length).equals(value)).toBe(true);
    expect(ZATCA_CSR_TEMPLATE[environment]).toBe(template);
    // exactly one template name: not another environment's too
    for (const other of Object.values(ZATCA_CSR_TEMPLATE)) {
      if (other !== template && !template.endsWith(other)) expect(der.includes(Buffer.from(other, 'latin1'))).toBe(false);
    }
  });

  it('defaults to the sandbox template, puts the template before the SAN, and carries no keyUsage', () => {
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();
    const der = Buffer.from(generateZatcaCsr(testSubject, privateKeyPem, publicKeyPem).csrBase64, 'base64');
    expect(der.includes(Buffer.from('TSTZATCA-Code-Signing', 'latin1'))).toBe(true);
    expect(der.indexOf(TEMPLATE_OID)).toBeLessThan(der.indexOf(SAN_OID));
    expect(der.indexOf(KEY_USAGE_OID)).toBe(-1);
  });

  it('gives ZATCA the base64 of the whole PEM text, not the DER', () => {
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();
    const r = generateZatcaCsr(testSubject, privateKeyPem, publicKeyPem);
    expect(Buffer.from(r.csrForZatca, 'base64').toString('utf8')).toBe(r.csrPem);
    expect(r.csrForZatca).not.toBe(r.csrBase64);
  });

  it('names the organisation by its name, and keeps the EGS string in the SAN serial number', () => {
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();
    const der = Buffer.from(generateZatcaCsr(testSubject, privateKeyPem, publicKeyPem).csrBase64, 'base64');
    const O = Buffer.concat([Buffer.from([0x06, 0x03, 0x55, 0x04, 0x0a, 0x0c, testSubject.organizationName.length]), Buffer.from(testSubject.organizationName)]);
    const SN = Buffer.concat([Buffer.from([0x06, 0x03, 0x55, 0x04, 0x05, 0x0c, testSubject.egsSerialNumber.length]), Buffer.from(testSubject.egsSerialNumber)]);
    expect(der.includes(O)).toBe(true);
    expect(der.includes(SN)).toBe(true);
  });
});
