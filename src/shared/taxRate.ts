/**
 * seen-readiness-fixes-task.md P1.2: one way to read a stored tax rate.
 *
 * orders.tax_rate and tax_invoices.tax_rate are fractions (0.15) since
 * 20270102000002 (older rows converted, and a trigger keeps later writes
 * fractions). A percentage (15) from an old app version is still read
 * right. A missing rate is null -- never silently 15 (that turned exempt
 * invoices into 15% ones), and a real 0 stays 0.
 */
export function taxRateFraction(stored: number | string | null | undefined): number | null {
  if (stored === null || stored === undefined || stored === '') return null;
  const n = Number(stored);
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 1 ? n / 100 : n;
}

/** The same rate as a percentage (15), or null when missing. */
export function taxRatePercent(stored: number | string | null | undefined): number | null {
  const f = taxRateFraction(stored);
  return f === null ? null : Math.round(f * 1_000_000) / 10_000;
}
