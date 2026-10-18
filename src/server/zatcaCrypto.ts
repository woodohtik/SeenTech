import crypto from 'crypto';

// تشفير مفتاح شهادة زاتكا الخاص (CSID private key) وسر واجهة زاتكا (secret)
// قبل تخزينهما في zatca_credentials -- بنفس نمط assistantCrypto.ts (AES-256
// -GCM)، بمفتاح تشفير منفصل خاص بزاتكا (ZATCA_ENCRYPTION_KEY) بدل إعادة
// استخدام مفتاح المساعد الذكي: فصل المفاتيح حسب فئة السر يمنع تسرّب مفتاح
// واحد من كشف كل الأسرار في المشروع دفعة واحدة. لا يُستدعى هذا الملف إلا من
// server.ts (Node) -- أبداً من حزمة المتصفح.

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = (process.env.ZATCA_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    throw new Error(
      'ZATCA_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and set it as a server-only env var.'
    );
  }
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('ZATCA_ENCRYPTION_KEY must decode to exactly 32 bytes (hex or base64).');
  }
  return key;
}

export function encryptZatcaSecret(plainText: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv:authTag:ciphertext, كل جزء base64
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptZatcaSecret(stored: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted ZATCA secret value.');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
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
    const der = Buffer.from(binarySecurityTokenBase64, 'base64');
    const cert = new crypto.X509Certificate(der);
    const parsed = new Date(cert.validTo);
    return isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}
