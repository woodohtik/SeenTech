import crypto from 'crypto';

// تشفير مفتاح شهادة زاتكا الخاص (CSID private key) وسر واجهة زاتكا (secret)
// قبل تخزينهما في zatca_credentials -- بنفس نمط assistantCrypto.ts (AES-256
// -GCM)، بمفتاح تشفير منفصل خاص بزاتكا (ZATCA_ENCRYPTION_KEY) بدل إعادة
// استخدام مفتاح المساعد الذكي: فصل المفاتيح حسب فئة السر يمنع تسرّب مفتاح
// واحد من كشف كل الأسرار في المشروع دفعة واحدة. لا يُستدعى هذا الملف إلا من
// server.ts (Node) -- أبداً من حزمة المتصفح.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * seen-readiness-fixes-task.md P6 (ZATCA-20): the key has versions, so it can
 * be rotated without losing what the old one encrypted.
 *
 *  - version 1 is ZATCA_ENCRYPTION_KEY; version N (N >= 2) is
 *    ZATCA_ENCRYPTION_KEY_V<N>;
 *  - ZATCA_ENCRYPTION_KEY_VERSION says which one new secrets are written
 *    with (default 1);
 *  - a stored value is "iv:tag:data" (version 1, the format every existing
 *    row has -- still written as-is while the current version is 1, so
 *    nothing changes until a rotation) or "v<N>:iv:tag:data".
 *
 * To rotate: set ZATCA_ENCRYPTION_KEY_V2 and ZATCA_ENCRYPTION_KEY_VERSION=2,
 * deploy, then run scripts/zatca/reencrypt-secrets.ts; the old key can be
 * removed once that reports nothing left on it.
 */
export function currentZatcaKeyVersion(): number {
  const raw = (process.env.ZATCA_ENCRYPTION_KEY_VERSION || '1').trim();
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 999) {
    throw new Error('ZATCA_ENCRYPTION_KEY_VERSION must be a whole number from 1 to 999.');
  }
  return n;
}

function getKey(version: number): Buffer {
  const name = version === 1 ? 'ZATCA_ENCRYPTION_KEY' : `ZATCA_ENCRYPTION_KEY_V${version}`;
  const raw = (process.env[name] || '').trim();
  if (!raw) {
    throw new Error(
      `${name} is not set. Generate one with \`openssl rand -hex 32\` and set it as a server-only env var.`
    );
  }
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes (hex or base64).`);
  }
  return key;
}

/** Which key version a stored secret was encrypted with. */
export function zatcaSecretKeyVersion(stored: string): number {
  const m = /^v(\d{1,3}):/.exec(stored);
  return m ? Number(m[1]) : 1;
}

export function encryptZatcaSecret(plainText: string): string {
  const version = currentZatcaKeyVersion();
  const key = getKey(version);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv:authTag:ciphertext, كل جزء base64 -- مسبوقة برقم الإصدار من الإصدار 2 فصاعداً
  const body = `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  return version === 1 ? body : `v${version}:${body}`;
}

export function decryptZatcaSecret(stored: string): string {
  const version = zatcaSecretKeyVersion(stored);
  const key = getKey(version);
  const [ivB64, tagB64, dataB64] = (version === 1 && !stored.startsWith('v1:') ? stored : stored.slice(stored.indexOf(':') + 1)).split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted ZATCA secret value.');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * The same secret under the current key version; null when it is already
 * there (nothing to write).
 */
export function reencryptZatcaSecret(stored: string): string | null {
  if (zatcaSecretKeyVersion(stored) === currentZatcaKeyVersion()) return null;
  return encryptZatcaSecret(decryptZatcaSecret(stored));
}

/**
 * seen-ai-assistant-zatca-cr-task.md, ZATCA #2: ZATCA's own CSID response
 * never states an expiry explicitly -- it's only present inside the X.509
 * certificate itself (binarySecurityToken, base64). Node's built-in
 * X509Certificate parses either PEM or DER without a new dependency; ZATCA's
 * WS-Security BinarySecurityToken convention is base64-of-DER, so decoding
 * the base64 and handing the raw bytes straight to X509Certificate is the
 * right shape. Returns null (never throws) on anything unparseable -- this
 * must never block onboarding from completing just because expiry tracking
 * couldn't be derived; the credential itself is still fully usable.
 */
export function extractCertificateExpiry(binarySecurityTokenBase64: string): Date | null {
  try {
    // P6 (ZATCA-15): ZATCA's binarySecurityToken is the base64 of the
    // certificate's own base64 text -- decoded once it is still text, not
    // DER, so the expiry was never read (and no expiry warning ever sent).
    // Same reading as readZatcaCertificate: a PEM, a base64 DER, or the
    // doubly-encoded token.
    let body = binarySecurityTokenBase64.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
    const once = Buffer.from(body, 'base64').toString('latin1');
    if (/^MII[A-Za-z0-9+/=]+$/.test(once)) body = once;
    const cert = new crypto.X509Certificate(Buffer.from(body, 'base64'));
    const parsed = new Date(cert.validTo);
    return isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}
