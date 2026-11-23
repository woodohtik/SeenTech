import { describe, expect, it } from 'vitest';
import { extractCertificateExpiry } from './zatcaCrypto';
import { makeTestCertificate } from './zatcaTestCertificate';

// seen-readiness-fixes-task.md P6 (ZATCA-15): the certificate's expiry is
// read from every shape it arrives in -- above all ZATCA's own
// binarySecurityToken, which is the base64 of the certificate's base64 text.
const { certificatePem } = makeTestCertificate(); // valid 2026-01-01 .. 2036-01-01
const base64Der = certificatePem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
const zatcaToken = Buffer.from(base64Der, 'latin1').toString('base64');
const EXPIRY = '2036-01-01T00:00:00.000Z';

describe('extractCertificateExpiry', () => {
  it("reads ZATCA's binarySecurityToken (base64 of the base64 certificate)", () => {
    expect(extractCertificateExpiry(zatcaToken)?.toISOString()).toBe(EXPIRY);
  });

  it('still reads a plain base64 DER and a PEM', () => {
    expect(extractCertificateExpiry(base64Der)?.toISOString()).toBe(EXPIRY);
    expect(extractCertificateExpiry(certificatePem)?.toISOString()).toBe(EXPIRY);
  });

  it('answers null, never throws, on something that is not a certificate', () => {
    expect(extractCertificateExpiry('not a certificate')).toBeNull();
    expect(extractCertificateExpiry('')).toBeNull();
  });
});
