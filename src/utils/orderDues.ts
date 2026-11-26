/**
 * The order list's red badge (seen-merchant-trial-test-2026-11-26.md, phase 3
 * item 9): what is left on THIS order. The customer's whole debt is shown when
 * the badge is opened, and in their profile -- not on each order's card.
 */
export function orderBadgeDue(order: { id?: string; remainingAmount?: number | null }): number {
  return Math.max(0, Number(order.remainingAmount) || 0);
}

export function customerTotalDue(unpaid: ReadonlyArray<{ remainingAmount?: number | null }>): number {
  return unpaid.reduce((sum, o) => sum + Math.max(0, Number(o.remainingAmount) || 0), 0);
}
