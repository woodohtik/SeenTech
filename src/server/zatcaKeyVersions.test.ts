import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptZatcaSecret, encryptZatcaSecret, reencryptZatcaSecret, zatcaSecretKeyVersion } from './zatcaCrypto';

// seen-readiness-fixes-task.md P6 (ZATCA-20): the key can be rotated.
const saved = { ...process.env };
const K1 = crypto.randomBytes(32).toString('hex');
const K2 = crypto.randomBytes(32).toString('hex');

beforeEach(() => {
  process.env.ZATCA_ENCRYPTION_KEY = K1;
  delete process.env.ZATCA_ENCRYPTION_KEY_V2;
  delete process.env.ZATCA_ENCRYPTION_KEY_VERSION;
});
afterEach(() => { process.env = { ...saved }; });

describe('ZATCA secret key versions', () => {
  it('before any rotation nothing changes: the stored format is the one every existing row has', () => {
    const stored = encryptZatcaSecret('private-key');
    expect(stored.split(':')).toHaveLength(3);
    expect(zatcaSecretKeyVersion(stored)).toBe(1);
    expect(decryptZatcaSecret(stored)).toBe('private-key');
    expect(reencryptZatcaSecret(stored)).toBeNull();
  });

  it('after a rotation: new secrets use the new key, old ones still open, and move over once', () => {
    const old = encryptZatcaSecret('private-key');
    process.env.ZATCA_ENCRYPTION_KEY_V2 = K2;
    process.env.ZATCA_ENCRYPTION_KEY_VERSION = '2';

    const fresh = encryptZatcaSecret('another');
    expect(fresh.startsWith('v2:')).toBe(true);
    expect(decryptZatcaSecret(fresh)).toBe('another');
    expect(decryptZatcaSecret(old)).toBe('private-key'); // version 1 still read with key 1

    const moved = reencryptZatcaSecret(old)!;
    expect(zatcaSecretKeyVersion(moved)).toBe(2);
    expect(decryptZatcaSecret(moved)).toBe('private-key');
    expect(reencryptZatcaSecret(moved)).toBeNull();

    // With the old key gone, what moved still opens; what did not, does not.
    delete process.env.ZATCA_ENCRYPTION_KEY;
    expect(decryptZatcaSecret(moved)).toBe('private-key');
    expect(() => decryptZatcaSecret(old)).toThrow(/ZATCA_ENCRYPTION_KEY is not set/);
  });

  it('a secret is never opened with the wrong version\'s key', () => {
    process.env.ZATCA_ENCRYPTION_KEY_V2 = K2;
    const v1 = encryptZatcaSecret('x');
    expect(() => decryptZatcaSecret(`v2:${v1}`)).toThrow();
  });

  it('refuses a version setting that is not a whole number', () => {
    process.env.ZATCA_ENCRYPTION_KEY_VERSION = 'two';
    expect(() => encryptZatcaSecret('x')).toThrow(/ZATCA_ENCRYPTION_KEY_VERSION/);
  });
});
