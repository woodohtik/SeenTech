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
