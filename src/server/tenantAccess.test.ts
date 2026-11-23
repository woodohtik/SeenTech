import { describe, expect, it } from 'vitest';
import { tenantAccessBlock } from './tenantAccess';

// seen-readiness-fixes-task.md P6 (SECURITY-12, PLATFORM-04, -17, -20): one
// rule for "is this shop open", used by the signed-in routes and by the
// public measurements link.
const now = new Date('2026-11-23T12:00:00Z');
const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();

describe('tenantAccessBlock', () => {
  it('an open shop: a running trial, a paid subscription, and the grace days after its end', () => {
    expect(tenantAccessBlock({ status: 'active', subscription_status: 'trial', trial_ends_at: at(3) }, now)).toBeNull();
    expect(tenantAccessBlock({ status: 'active', subscription_status: 'active', subscription_end_date: at(30) }, now)).toBeNull();
    expect(tenantAccessBlock({ status: 'active', subscription_status: 'active', subscription_end_date: at(-2) }, now)).toBeNull();
  });

  it('a paid shop is not closed by its old trial date', () => {
    expect(tenantAccessBlock({ status: 'active', subscription_status: 'active', trial_ends_at: at(-200), subscription_end_date: at(30) }, now)).toBeNull();
  });

  it('closed: deactivated, in the trash, locked, a trial past its end, a subscription past its grace', () => {
    expect(tenantAccessBlock({ status: 'inactive' }, now)).toEqual({ http: 403, code: 'tenant_inactive' });
    expect(tenantAccessBlock({ status: 'active', trashed_at: at(-1) }, now)).toEqual({ http: 403, code: 'tenant_deleted' });
    expect(tenantAccessBlock({ status: 'active', subscription_status: 'locked' }, now)?.code).toBe('subscription_locked');
    expect(tenantAccessBlock({ status: 'active', subscription_status: 'purge_pending' }, now)?.code).toBe('subscription_locked');
    expect(tenantAccessBlock({ status: 'active', subscription_status: 'trial', trial_ends_at: at(-0.01) }, now)?.code).toBe('subscription_locked');
    expect(tenantAccessBlock({ status: 'active', subscription_status: 'active', subscription_end_date: at(-4) }, now)?.code).toBe('subscription_locked');
  });
});
