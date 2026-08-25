import crypto from 'crypto';

// تشفير مفتاح API الخاص بمساعد سين الذكي (AES-256-GCM) قبل تخزينه في
// assistant_settings.api_key_encrypted — لا يُخزَّن أي مفتاح كنص صريح أبداً.
// يعتمد على ASSISTANT_ENCRYPTION_KEY (متغير بيئة سيرفري فقط، 32 بايت كـ hex/base64).

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = (process.env.ASSISTANT_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    throw new Error(
      'ASSISTANT_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and set it as a server-only env var.'
    );
  }
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('ASSISTANT_ENCRYPTION_KEY must decode to exactly 32 bytes (hex or base64).');
  }
  return key;
}

export function encryptApiKey(plainText: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv:authTag:ciphertext, كل جزء base64
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptApiKey(stored: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted API key value.');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

// يعرض فقط آخر 4 خانات — يُستخدم في استجابات GET حتى لا يتسرب المفتاح كاملاً للواجهة.
export function maskApiKey(plainText: string): string {
  if (!plainText) return '';
  const tail = plainText.slice(-4);
  return `${'•'.repeat(8)}${tail}`;
}
