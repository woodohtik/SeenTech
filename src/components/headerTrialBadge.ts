/**
 * Whether the header shows its "trial: N days left" badge
 * (seen-merchant-trial-test-2026-11-26.md, phase 4): not while the expiry
 * banner (SubscriptionExpiryBanner -- trial 7 days, subscription 14) says the
 * same thing just above it.
 */
export function showHeaderTrialBadge(days: number | null, isTrial: boolean): boolean {
  if (days === null) return false;
  if (days === 0) return true;
  return days > (isTrial ? 7 : 14);
}
