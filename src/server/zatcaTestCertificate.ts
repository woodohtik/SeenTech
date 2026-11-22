import crypto from 'crypto';

/**
 * TESTS ONLY (zatcaInvoiceXml.test.ts, zatcaChain.test.ts): a fresh secp256k1
 * key and a self-signed X.509 certificate, made in memory on every run -- no
 * key file in the repository (.gitignore keeps *.pem out), never issued by
 * ZATCA, trusted by nobody. The issuer mimics ZATCA's sandbox CA name so the
 * XAdES IssuerSerial is exercised the same way.
 */

const len = (n: number) => (n < 0x80 ? Buffer.from([n]) : (() => {
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
})());
const tlv = (tag: number, content: Buffer) => Buffer.concat([Buffer.from([tag]), len(content.length), content]);
const seq = (...c: Buffer[]) => tlv(0x30, Buffer.concat(c));
const set = (...c: Buffer[]) => tlv(0x31, Buffer.concat(c));

function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const out = [a * 40 + b];
  for (const n of rest) {
    const chunk: number[] = [];
    let v = n;
    do { chunk.unshift(v & 0x7f); v = Math.floor(v / 128); } while (v > 0);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80;
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

const DC = '0.9.2342.19200300.100.1.25';
const CN = '2.5.4.3';
const ECDSA_SHA256 = '1.2.840.10045.4.3.2';
export const TEST_CERT_SERIAL_HEX = '1234567890abcdef';
export const TEST_CERT_ISSUER = 'CN=TSZEINVOICE-SubCA-1-TEST, DC=extgazt, DC=gov, DC=local';

function name(): Buffer {
  const rdn = (type: string, tag: number, value: string) => set(seq(oid(type), tlv(tag, Buffer.from(value, 'utf8'))));
  return seq(rdn(DC, 0x16, 'local'), rdn(DC, 0x16, 'gov'), rdn(DC, 0x16, 'extgazt'), rdn(CN, 0x0c, 'TSZEINVOICE-SubCA-1-TEST'));
}

export function makeTestCertificate(): { privateKeyPem: string; certificatePem: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const alg = seq(oid(ECDSA_SHA256));
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))), // v3
    tlv(0x02, Buffer.from(TEST_CERT_SERIAL_HEX, 'hex')),
    alg,
    name(),
    seq(tlv(0x17, Buffer.from('260101000000Z')), tlv(0x17, Buffer.from('360101000000Z'))),
    name(),
    publicKey.export({ type: 'spki', format: 'der' }) as Buffer,
  );
  const signature = crypto.sign('sha256', tbs, privateKey);
  const der = seq(tbs, alg, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const body = der.toString('base64').match(/.{1,64}/g)!.join('\n');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    certificatePem: `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`,
  };
}
