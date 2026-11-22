import crypto from 'crypto';

/**
 * A locally generated secp256k1 key pair, for tests only (zatcaCsr.test.ts).
 * Never a substitute for the key behind a real ZATCA certificate.
 *
 * Invoice signing lives in zatcaXades.ts (seen-readiness-fixes-task.md P2.1):
 * ZATCA's ds:SignatureValue is ECDSA over the invoice hash bytes in DER --
 * not the raw r||s (ieee-p1363) this file used to produce.
 */
export interface EcKeyPairPem {
  privateKeyPem: string;
  publicKeyPem: string;
}

export function generateTestKeyPair(): EcKeyPairPem {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'secp256k1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  } as any) as unknown as { privateKey: string; publicKey: string };
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}
