import { describe, expect, it } from 'vitest';
import { expiryNotice } from './SubscriptionExpiryBanner';

// seen-readiness-fixes-task.md P5 (PLATFORM-02).
const now = new Date('2026-11-23T12:00:00Z');
const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();

describe('expiryNotice', () => {
  it('a paid subscription: warns from 14 days, counting up the last part-day', () => {
    expect(expiryNotice({ subscription_status: 'active', is_trial: false, subscription_end_date: at(20) }, now)).toBeNull();
    expect(expiryNotice({ subscription_status: 'active', is_trial: false, subscription_end_date: at(14) }, now)).toEqual({ kind: 'subscription', days: 14 });
    expect(expiryNotice({ subscription_status: 'active', is_trial: false, subscription_end_date: at(0.5) }, now)).toEqual({ kind: 'subscription', days: 1 });
  });

  it('after the end: the grace notice with the lock date, 3 days on, then nothing', () => {
    const n = expiryNotice({ subscription_status: 'active', is_trial: false, subscription_end_date: at(-1) }, now);
    expect(n).toEqual({ kind: 'grace', lockAt: new Date(at(2)) });
    expect(expiryNotice({ subscription_status: 'active', is_trial: false, subscription_end_date: at(-3.5) }, now)).toBeNull();
  });

  it('a trial: from 7 days only; a locked shop: nothing', () => {
    expect(expiryNotice({ subscription_status: 'trial', is_trial: true, trial_ends_at: at(10) }, now)).toBeNull();
    expect(expiryNotice({ subscription_status: 'trial', is_trial: true, trial_ends_at: at(6.2) }, now)).toEqual({ kind: 'trial', days: 7 });
    expect(expiryNotice({ subscription_status: 'locked', subscription_end_date: at(-1) }, now)).toBeNull();
  });
});
