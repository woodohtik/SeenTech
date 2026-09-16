import crypto from 'crypto';

/**
 * ZATCA Phase 2 readiness (seen-zatca-readiness-task.md): ECDSA secp256k1
 * sign/verify, matching ZATCA's cryptographic-stamp requirement.
 *
 * UNTESTED against ZATCA's real compliance/sandbox environment -- there is
 * no way to validate that without a real Compliance CSID (Phase 1, a
 * business-side task only the tenant/business owner can complete by
 * registering with ZATCA directly; nothing here can substitute for that).
 * What zatcaSigning.test.ts DOES verify: the sign/verify round-trip is
 * internally consistent -- a signature this module produces verifies
 * successfully with this module's own verify function, and any tampering
 * with the signed data or the signature itself is correctly rejected --
 * using a locally generated TEST key pair, never a real ZATCA-issued one.
 *
 * IMPORTANT, easy to get wrong: XML-DSig (the signature format ZATCA's
 * UBLExtensions ds:Signature block requires) encodes an ECDSA signature as
 * the raw, fixed-length concatenation of r and s (W3C xmldsig-more's
 * "ECDSA-SHA256" URI, RFC 6931) -- NOT the ASN.1 DER encoding most
 * TLS/X.509 tooling (including OpenSSL's default `openssl dgst -sign`)
 * produces. Node's crypto.sign/verify support the XML-DSig format directly
 * via { dsaEncoding: 'ieee-p1363' }; using the default ('der') instead
 * produces a signature that's cryptographically valid but that ZATCA's XML
 * validator would reject outright, because it isn't the byte format the
 * schema expects there.
 */

const CURVE = 'secp256k1';
const HASH_ALGORITHM = 'sha256';

export interface EcKeyPairPem {
  privateKeyPem: string;
  publicKeyPem: string;
}

/**
 * A locally generated secp256k1 key pair for testing this module's sign/
 * verify logic in isolation. NOT a substitute for a real ZATCA CSID: the
 * real private key comes from ZATCA's own CSR-based onboarding (Phase 1),
 * and only that key's corresponding certificate is trusted by ZATCA's
 * servers. This function exists so signData/verifySignature have something
 * to round-trip against without needing that real key.
 */
export function generateTestKeyPair(): EcKeyPairPem {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: CURVE,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  } as any) as unknown as { privateKey: string; publicKey: string };
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

/**
 * Signs `data` with an EC secp256k1 private key (PEM, PKCS8), returning the
 * base64-encoded XML-DSig-format (raw r||s) signature ZATCA's UBLExtensions
 * ds:SignatureValue expects.
 */
export function signData(data: Buffer | string, privateKeyPem: string): string {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const signature = crypto.sign(HASH_ALGORITHM, payload, {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  } as unknown as crypto.SignPrivateKeyInput);
  return signature.toString('base64');
}

/** Verifies a base64 XML-DSig-format (raw r||s) signature against `data`
 *  and an EC secp256k1 public key (PEM, SPKI). Never throws -- a malformed
 *  signature or key is just a failed verification, not an exception. */
export function verifySignature(data: Buffer | string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    return crypto.verify(
      HASH_ALGORITHM,
      payload,
      { key: publicKeyPem, dsaEncoding: 'ieee-p1363' } as unknown as crypto.VerifyPublicKeyInput,
      Buffer.from(signatureBase64, 'base64')
    );
  } catch {
    return false;
  }
}

/** SHA-256 digest of `data`, base64-encoded -- the exact hash ZATCA's
 *  invoice hash (and the PIH chain, once it hashes the real invoice XML
 *  instead of the placeholder in create_pos_sale) needs to be signed. */
export function sha256Base64(data: Buffer | string): string {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  return crypto.createHash(HASH_ALGORITHM).update(payload).digest('base64');
}
