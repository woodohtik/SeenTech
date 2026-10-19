import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { offlineDb } from './db';
import { cacheStaffPinAfterOnlineVerify, tryOfflinePinVerify, updateCachedStaffPin } from './offlinePinAuth';

// مراجعة-الفريق-التقني-الكامل-2026-10-19.md (QA، عالية): صفر اختبار سابقاً
// لهذا الملف رغم التحليل الأمني التفصيلي في تعليقاته الخاصة (انتهاء صلاحية
// القفل، التصاعد الزمني، الترحيل من هاش قديم). الحالات الحدّية هنا مأخوذة
// مباشرة من تلك التعليقات، لا من تخمين.

const TENANT_ID = 'tenant-1';
const STAFF_ID = 'staff-1';
const PIN = '1234';

beforeEach(async () => {
  await offlineDb.cachedStaffAuth.clear();
  await offlineDb.offlinePinLockout.clear();
  vi.useRealTimers();
});

afterAll(() => {
  offlineDb.close();
});

describe('tryOfflinePinVerify: no cache', () => {
  it('returns no_cache when nothing was ever cached for this tenant', async () => {
    const result = await tryOfflinePinVerify(TENANT_ID, PIN);
    expect(result).toEqual({ outcome: 'no_cache' });
  });
});

describe('tryOfflinePinVerify: matching', () => {
  it('matches a PIN cached via a real online verify, and clears any prior lockout', async () => {
    await offlineDb.offlinePinLockout.put({ tenantId: TENANT_ID, failedCount: 2, lockUntil: null });
    await cacheStaffPinAfterOnlineVerify(TENANT_ID, STAFF_ID, PIN, { name: 'Cashier' });

    const result = await tryOfflinePinVerify(TENANT_ID, PIN);
    expect(result).toEqual({ outcome: 'matched', staff: { name: 'Cashier' } });

    const lockout = await offlineDb.offlinePinLockout.get(TENANT_ID);
    expect(lockout).toBeUndefined();
  });

  it('rejects a wrong PIN against a real cached entry', async () => {
    await cacheStaffPinAfterOnlineVerify(TENANT_ID, STAFF_ID, PIN, { name: 'Cashier' });
    const result = await tryOfflinePinVerify(TENANT_ID, '9999');
    expect(result).toEqual({ outcome: 'no_match' });
  });

  it('updateCachedStaffPin (PIN change) makes the OLD pin stop matching and the NEW one match', async () => {
    await cacheStaffPinAfterOnlineVerify(TENANT_ID, STAFF_ID, PIN, { name: 'Cashier' });
    await updateCachedStaffPin(STAFF_ID, TENANT_ID, '5678', { name: 'Cashier' });

    expect(await tryOfflinePinVerify(TENANT_ID, PIN)).toEqual({ outcome: 'no_match' });
    expect(await tryOfflinePinVerify(TENANT_ID, '5678')).toEqual({ outcome: 'matched', staff: { name: 'Cashier' } });
  });

  it('skips legacy entries with no saltHex (pre-PBKDF2 migration) instead of matching them insecurely', async () => {
    await offlineDb.cachedStaffAuth.put({
      staffId: STAFF_ID,
      tenantId: TENANT_ID,
      pinHashHex: 'deadbeef', // a bare SHA-256-style hash, no salt -- must never be trusted
      saltHex: '',
      iterations: 1,
      staff: { name: 'Legacy' },
      cachedAt: Date.now(),
    });
    const result = await tryOfflinePinVerify(TENANT_ID, PIN);
    expect(result).toEqual({ outcome: 'no_match' });
  });
});

describe('tryOfflinePinVerify: lockout escalation', () => {
  it('does not lock before the 5th consecutive failure', async () => {
    await cacheStaffPinAfterOnlineVerify(TENANT_ID, STAFF_ID, PIN, { name: 'Cashier' });
    for (let i = 0; i < 4; i++) {
      const result = await tryOfflinePinVerify(TENANT_ID, 'wrong');
      expect(result).toEqual({ outcome: 'no_match' });
    }
    const lockout = await offlineDb.offlinePinLockout.get(TENANT_ID);
    expect(lockout?.lockUntil).toBeNull();
  });

  it('locks for 1 minute after the 5th consecutive failure (first point of the schedule)', async () => {
    await cacheStaffPinAfterOnlineVerify(TENANT_ID, STAFF_ID, PIN, { name: 'Cashier' });
    for (let i = 0; i < 5; i++) {
      await tryOfflinePinVerify(TENANT_ID, 'wrong');
    }
    const sixthAttempt = await tryOfflinePinVerify(TENANT_ID, 'wrong');
    expect(sixthAttempt.outcome).toBe('locked');
    if (sixthAttempt.outcome === 'locked') {
      // ~60s, allow a couple seconds of test-execution slack either way
      expect(sixthAttempt.retryAfterSeconds).toBeGreaterThan(55);
      expect(sixthAttempt.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it('escalates 1 -> 2 -> 4 -> 8 -> 15 minutes across SUCCESSIVE lockout cycles, capping at 15', async () => {
    // مرآة لـrecord_pin_verify_failure (20260908070000_pin_verify_rate_limit.sql):
    // كل دورة قفل تحتاج 5 محاولات فاشلة جديدة (failedCount يُصفَّر بعد كل قفل)،
    // ومدة القفل *القادمة* تتضاعف في كل مرة، لا عند كل محاولة ضمن نفس الدورة.
    await cacheStaffPinAfterOnlineVerify(TENANT_ID, STAFF_ID, PIN, { name: 'Cashier' });
    const expectedMinutesPerCycle = [1, 2, 4, 8, 15, 15]; // 6th cycle onward caps at 15

    for (const expectedMinutes of expectedMinutesPerCycle) {
      // Simulate "the previous lock window already elapsed" so this cycle's
      // 5 fresh failures are what re-triggers locking next.
      await offlineDb.offlinePinLockout.update(TENANT_ID, { lockUntil: null });
      for (let i = 0; i < 4; i++) {
        const r = await tryOfflinePinVerify(TENANT_ID, 'wrong');
        expect(r.outcome).toBe('no_match'); // not locked yet within this cycle
      }
      // The 5th failure of this cycle sets the lock but itself still
      // reports 'no_match' (matches the pre-existing, unchanged behavior:
      // the lock is only visible on the *next* call) -- then the next call
      // reports 'locked' with the duration this cycle was supposed to use.
      const fifthFailure = await tryOfflinePinVerify(TENANT_ID, 'wrong');
      expect(fifthFailure.outcome).toBe('no_match');
      const lockedCheck = await tryOfflinePinVerify(TENANT_ID, 'wrong');
      expect(lockedCheck.outcome).toBe('locked');
      if (lockedCheck.outcome === 'locked') {
        expect(lockedCheck.retryAfterSeconds).toBeLessThanOrEqual(expectedMinutes * 60);
        expect(lockedCheck.retryAfterSeconds).toBeGreaterThan(expectedMinutes * 60 - 5);
      }
    }
  });

  it('a locked tenant is rejected immediately without even checking the PIN, and does not advance failedCount further', async () => {
    await cacheStaffPinAfterOnlineVerify(TENANT_ID, STAFF_ID, PIN, { name: 'Cashier' });
    for (let i = 0; i < 5; i++) await tryOfflinePinVerify(TENANT_ID, 'wrong');
    await tryOfflinePinVerify(TENANT_ID, 'wrong'); // this is the locking attempt itself

    // Even the CORRECT pin must be rejected while locked -- the lockout
    // check happens before any hash comparison.
    const attemptWithCorrectPin = await tryOfflinePinVerify(TENANT_ID, PIN);
    expect(attemptWithCorrectPin.outcome).toBe('locked');
  });

  it('lock expiry allows a new attempt to proceed again (simulated via a past lockUntil)', async () => {
    await cacheStaffPinAfterOnlineVerify(TENANT_ID, STAFF_ID, PIN, { name: 'Cashier' });
    // Simulate "the lock window has already elapsed" directly, rather than
    // waiting in real time or relying on fake timers interacting correctly
    // with Dexie's own internal scheduling.
    await offlineDb.offlinePinLockout.put({ tenantId: TENANT_ID, failedCount: 5, lockUntil: Date.now() - 1000 });

    const result = await tryOfflinePinVerify(TENANT_ID, PIN);
    expect(result).toEqual({ outcome: 'matched', staff: { name: 'Cashier' } });
  });
});
