/**
 * Who sees a customer's measurements (seen-open-verticals-task.md, wave 1,
 * question 6's default). In a women's tailoring shop: only staff with
 * «عرض مقاسات العملاء» (by default owner, admin, managers and the tailors --
 * not the cashier); the receipt never carries them. Men's tailoring keeps
 * today's rule (whoever sees the customer sees the thobe measurements).
 */
export const MEASUREMENTS_PERMISSION = 'customers.view_measurements' as const;

export function canSeeMeasurements(set: string | null | undefined, hasPermission: (key: typeof MEASUREMENTS_PERMISSION) => boolean): boolean {
  if (!set) return false;
  if (set === 'womens') return hasPermission(MEASUREMENTS_PERMISSION);
  return true;
}
