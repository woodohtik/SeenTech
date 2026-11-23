/**
 * seen-readiness-fixes-task.md P6 (SECURITY-12, PLATFORM-04): the server's
 * routes run as service_role (no RLS), so they must refuse a shop the
 * database itself would refuse. Same rules as app_current_tenant_id():
 * deactivated, in the trash, locked / pending purge, or a paid subscription
 * past its end plus the grace days (20270106000003).
 */
export const SUBSCRIPTION_GRACE_DAYS = 3;

export type TenantState = {
  status?: string | null;
  trashed_at?: string | null;
  subscription_status?: string | null;
  subscription_end_date?: string | null;
  trial_ends_at?: string | null;
};

export type TenantBlock = { http: 402 | 403; code: 'tenant_inactive' | 'tenant_deleted' | 'subscription_locked' };

export function tenantAccessBlock(t: TenantState | null | undefined, now: Date = new Date()): TenantBlock | null {
  if (!t) return null; // as app_current_tenant_id(): no row, nothing to refuse on
  if (t.status === 'inactive') return { http: 403, code: 'tenant_inactive' };
  if (t.trashed_at) return { http: 403, code: 'tenant_deleted' };
  if (t.subscription_status === 'locked' || t.subscription_status === 'purge_pending') return { http: 402, code: 'subscription_locked' };
  // P6 (PLATFORM-20): a trial past its end, even if the lock sweep has not run.
  if (t.subscription_status === 'trial' && t.trial_ends_at) {
    const trialEnd = new Date(t.trial_ends_at).getTime();
    if (Number.isFinite(trialEnd) && trialEnd < now.getTime()) return { http: 402, code: 'subscription_locked' };
  }
  if (t.subscription_end_date) {
    const end = new Date(t.subscription_end_date).getTime();
    if (Number.isFinite(end) && end + SUBSCRIPTION_GRACE_DAYS * 86_400_000 < now.getTime()) {
      return { http: 402, code: 'subscription_locked' };
    }
  }
  return null;
}
