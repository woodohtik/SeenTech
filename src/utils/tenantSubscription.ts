import type { Tenant, Plan } from '../types';

/** اسم الخطة المطابقة لـplanId، أو تسمية "خطة مخصصة" إن لم تُطابق أي خطة معروفة. */
export function getPlanName(plans: Plan[], planId: string, customPlanLabel: string): string {
  return plans.find((p) => p.id === planId)?.name || customPlanLabel;
}

export interface SubscriptionInfo {
  type: string;
  isTrial: boolean;
  daysLeft: number;
  expiryDate: Date;
  progress: number;
}

/**
 * يحسب حالة اشتراك التاجر الحالية (تجربة/مدفوع، الأيام المتبقية، نسبة
 * التقدّم). يفضّل subscription_end_date الفعلي (محدَّث عند الموافقة على طلب
 * اشتراك أو منح خطة يدوياً) على تقدير createdAt+365 يوم، الذي لا يصلح إلا
 * قبل أول تجديد فعلي لهذا التاجر -- انظر seen-billing-renewal-task.md.
 */
export function getSubscriptionInfo(
  plans: Plan[],
  tenant: Tenant,
  labels: { trialBadge: string; paidSubscription: string },
): SubscriptionInfo {
  const plan = plans.find((p) => p.id === tenant.planId);
  const isTrial =
    tenant.planId === 'free' ||
    (!plan && tenant.planId !== 'basic') ||
    (plan && plan.price === 0) ||
    (tenant.planId && typeof tenant.planId === 'string' && tenant.planId.includes('trial'));
  const creationDate = new Date(tenant.createdAt);
  const now = new Date();

  // Assume 14 days trial or 365 days pro based on standard logic if duration not in DB
  const durationDays = isTrial ? 14 : 365;
  const expiryDate =
    !isTrial && tenant.subscription_end_date
      ? new Date(tenant.subscription_end_date)
      : (() => {
          const d = new Date(creationDate);
          d.setDate(d.getDate() + durationDays);
          return d;
        })();

  const diffTime = expiryDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const totalSpanDays = Math.max(1, Math.ceil((expiryDate.getTime() - creationDate.getTime()) / (1000 * 60 * 60 * 24)));

  return {
    type: isTrial ? labels.trialBadge : labels.paidSubscription,
    isTrial: !!isTrial,
    daysLeft: Math.max(0, diffDays),
    expiryDate,
    progress: Math.min(100, Math.max(0, ((totalSpanDays - diffDays) / totalSpanDays) * 100)),
  };
}
