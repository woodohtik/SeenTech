/**
 * Display-only identity snapshot (seen-offline-sync-architecture-task.md
 * Phase 5). Lets the app render the POS shell for a staff member who was
 * already resolved online, if the device reloads while genuinely offline
 * and AuthContext's normal network-dependent resolution can't run.
 *
 * This is explicitly NOT a security layer -- every write still goes through
 * the exact same server-side RLS checks it always did, regardless of what's
 * cached here. A stale/incorrect snapshot can make the UI show the wrong
 * thing locally for a while; it can never grant real access, because
 * nothing server-side trusts this cache.
 */

const STORAGE_KEY_PREFIX = 'offline_identity_snapshot:';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h -- generous for a temporary outage, bounded so a permanently offline/decommissioned device doesn't keep rendering a year-old identity forever.

export interface IdentitySnapshot {
  uid: string;
  isApproved: boolean;
  userRole: string | null;
  tenantId: string | null;
  onboardingStep: number;
  hasStaffWithPin: boolean | null;
  currentUserStaff: unknown;
  cachedAt: number;
}

export function cacheIdentitySnapshot(uid: string, snapshot: Omit<IdentitySnapshot, 'uid' | 'cachedAt'>): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + uid, JSON.stringify({ uid, ...snapshot, cachedAt: Date.now() }));
  } catch {
    // localStorage can throw (quota, private mode) -- caching is a nice-to-have, never worth failing the real resolution over.
  }
}

export function getCachedIdentitySnapshot(uid: string): IdentitySnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + uid);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IdentitySnapshot;
    if (Date.now() - parsed.cachedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}
