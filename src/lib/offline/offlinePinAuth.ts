import { offlineDb, type CachedStaffAuth } from './db';

/**
 * Offline PIN fallback (seen-offline-sync-architecture-task.md Phase 5,
 * explicit owner decision): when /api/staff/verify-pin can't be reached at
 * all, fall back to a PIN this exact device already verified successfully
 * online at least once. The owner explicitly accepted the risk that a since
 * -revoked or since-changed PIN can stay valid locally until this device
 * reconnects and re-syncs -- that trade-off is deliberate, not an oversight.
 *
 * What is NOT accepted, and had to be added here rather than skipped: the
 * server enforces an escalating lockout after 5 wrong PIN attempts
 * specifically because a 4-digit PIN is only 10,000 combinations (see
 * server.ts's VERIFY_PIN_MAX_ATTEMPTS comment). A local comparison with no
 * equivalent limit would let anyone with physical access to an offline
 * device try all 10,000 combinations in a tight loop in under a second --
 * an offline device is not a lower-stakes target, so it gets the same
 * lockout shape (mirrored client-side since there's no server to ask).
 *
 * That lockout only stops someone going through the normal lock-screen UI.
 * It cannot stop someone with actual DevTools console access to an unlocked
 * device from reading cachedStaffAuth directly and hashing candidates
 * themselves, bypassing tryOfflinePinVerify entirely -- a security review
 * confirmed this (see docs/reports for the session's security-review
 * output). Salted PBKDF2 (below) is the mitigation for THAT path: it can't
 * stop a determined attacker with a hash cracker, but it raises the direct
 * -DB-access brute force from "under a second" to "minutes", which matters
 * because it's the only lever available once the attacker has already
 * stepped outside the UI this lockout actually gates.
 */

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES_SCHEDULE = [1, 2, 4, 8, 15]; // capped at 15, matches the server's own cap

const PBKDF2_ITERATIONS = 210_000; // OWASP's 2023 baseline for PBKDF2-HMAC-SHA256
const SALT_BYTES = 16;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derivePinHash(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, keyMaterial, 256);
  return bytesToHex(new Uint8Array(bits));
}

export async function cacheStaffPinAfterOnlineVerify(tenantId: string, staffId: string, pin: string, staff: unknown): Promise<void> {
  // This is a best-effort background write, called fire-and-forget right
  // after a successful login (PinLogin.tsx/LockScreen.tsx don't await it,
  // so the user is already past this screen by the time it runs) -- it must
  // never surface as an unhandled rejection. The top-level ErrorBoundary
  // listens for exactly that on window and shows a full-page crash screen,
  // which would turn "the offline cache failed to warm" into "login looks
  // broken" for a step the user has already moved past. A real login
  // failure is caught and shown by PinLogin/LockScreen's own try/catch
  // further up the call stack; this one guards a pure side effect.
  try {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const pinHashHex = await derivePinHash(pin, salt, PBKDF2_ITERATIONS);
    await offlineDb.cachedStaffAuth.put({
      staffId,
      tenantId,
      pinHashHex,
      saltHex: bytesToHex(salt),
      iterations: PBKDF2_ITERATIONS,
      staff,
      cachedAt: Date.now(),
    });
    // A real online verify is a strong signal this device/session pairing is
    // legitimate -- don't leave a stale offline lockout (e.g. from someone
    // else's earlier failed guesses) blocking this tenant's next genuine
    // offline attempt.
    await offlineDb.offlinePinLockout.delete(tenantId);
  } catch (err) {
    console.error('[offlinePinAuth] Failed to cache PIN for offline use (non-fatal):', err);
  }
}

/** Call after a successful online PIN change (PinLogin's mustChangePin flow) so a stale cached hash can't outlive the change on this device. */
export async function updateCachedStaffPin(staffId: string, tenantId: string, newPin: string, staff: unknown): Promise<void> {
  await cacheStaffPinAfterOnlineVerify(tenantId, staffId, newPin, staff);
}

export type OfflinePinResult =
  | { outcome: 'locked'; retryAfterSeconds: number }
  | { outcome: 'matched'; staff: unknown }
  | { outcome: 'no_match' }
  | { outcome: 'no_cache' };

export async function tryOfflinePinVerify(tenantId: string, pin: string): Promise<OfflinePinResult> {
  const lockout = await offlineDb.offlinePinLockout.get(tenantId);
  if (lockout?.lockUntil && lockout.lockUntil > Date.now()) {
    return { outcome: 'locked', retryAfterSeconds: Math.ceil((lockout.lockUntil - Date.now()) / 1000) };
  }

  const cachedEntries = await offlineDb.cachedStaffAuth.where('tenantId').equals(tenantId).toArray();
  if (cachedEntries.length === 0) {
    return { outcome: 'no_cache' };
  }

  let match: CachedStaffAuth | undefined;
  for (const entry of cachedEntries) {
    // Entries cached before this file switched from bare SHA-256 to salted
    // PBKDF2 have no saltHex -- skip them rather than fall back to the
    // weaker scheme; they self-heal the next time that staff member logs
    // in online, which re-caches them in the new format.
    if (!entry.saltHex) continue;
    const candidateHash = await derivePinHash(pin, hexToBytes(entry.saltHex), entry.iterations || PBKDF2_ITERATIONS);
    if (candidateHash === entry.pinHashHex) {
      match = entry;
      break;
    }
  }

  if (match) {
    await offlineDb.offlinePinLockout.delete(tenantId);
    return { outcome: 'matched', staff: match.staff };
  }

  const failedCount = (lockout?.failedCount || 0) + 1;
  const lockMinutes = LOCK_MINUTES_SCHEDULE[Math.min(failedCount - 1, LOCK_MINUTES_SCHEDULE.length - 1)];
  const lockUntil = failedCount >= MAX_ATTEMPTS ? Date.now() + lockMinutes * 60 * 1000 : null;
  await offlineDb.offlinePinLockout.put({ tenantId, failedCount, lockUntil });

  return { outcome: 'no_match' };
}
