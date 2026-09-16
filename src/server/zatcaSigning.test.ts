import { describe, expect, it } from 'vitest';
import { generateTestKeyPair, signData, verifySignature, sha256Base64 } from './zatcaSigning';

describe('zatcaSigning', () => {
  it('generates a secp256k1 key pair as PEM strings', () => {
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();
    expect(privateKeyPem).toContain('BEGIN PRIVATE KEY');
    expect(publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });

  it('signs data and verifies successfully with the matching public key', () => {
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();
    const invoiceHash = sha256Base64('invoice-content-example');
    const signature = signData(invoiceHash, privateKeyPem);
    expect(verifySignature(invoiceHash, signature, publicKeyPem)).toBe(true);
  });

  it('produces a fixed-length raw r||s signature (IEEE P1363 / XML-DSig), not ASN.1 DER', () => {
    // For secp256k1 (32-byte order), a raw r||s signature is always exactly
    // 64 bytes -- DER-encoded signatures vary in length (typically 70-72
    // bytes, with a few bytes of ASN.1 SEQUENCE/INTEGER framing). This is
    // the concrete, checkable difference that would otherwise only surface
    // as a rejection from ZATCA's own XML validator.
    const { privateKeyPem } = generateTestKeyPair();
    const signature = signData('some invoice hash', privateKeyPem);
    const signatureBytes = Buffer.from(signature, 'base64');
    expect(signatureBytes.length).toBe(64);
  });

  it('rejects a signature when the signed data was tampered with', () => {
    const { privateKeyPem, publicKeyPem } = generateTestKeyPair();
    const signature = signData('original invoice hash', privateKeyPem);
    expect(verifySignature('tampered invoice hash', signature, publicKeyPem)).toBe(false);
  });

  it('rejects a signature verified against the wrong public key', () => {
    const pairA = generateTestKeyPair();
    const pairB = generateTestKeyPair();
    const signature = signData('invoice hash', pairA.privateKeyPem);
    expect(verifySignature('invoice hash', signature, pairB.publicKeyPem)).toBe(false);
  });

  it('rejects a malformed signature instead of throwing', () => {
    const { publicKeyPem } = generateTestKeyPair();
    expect(verifySignature('invoice hash', 'not-a-real-signature', publicKeyPem)).toBe(false);
  });

  it('sha256Base64 is deterministic and sensitive to any input change', () => {
    const a = sha256Base64('same input');
    const b = sha256Base64('same input');
    const c = sha256Base64('different input');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
