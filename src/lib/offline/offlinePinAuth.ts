import { offlineDb } from './db';

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
 */

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES_SCHEDULE = [1, 2, 4, 8, 15]; // capped at 15, matches the server's own cap

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function cacheStaffPinAfterOnlineVerify(tenantId: string, staffId: string, pin: string, staff: unknown): Promise<void> {
  const pinHashHex = await sha256Hex(pin);
  await offlineDb.cachedStaffAuth.put({ staffId, tenantId, pinHashHex, staff, cachedAt: Date.now() });
  // A real online verify is a strong signal this device/session pairing is
  // legitimate -- don't leave a stale offline lockout (e.g. from someone
  // else's earlier failed guesses) blocking this tenant's next genuine
  // offline attempt.
  await offlineDb.offlinePinLockout.delete(tenantId);
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

  const pinHashHex = await sha256Hex(pin);
  const match = cachedEntries.find(entry => entry.pinHashHex === pinHashHex);

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
