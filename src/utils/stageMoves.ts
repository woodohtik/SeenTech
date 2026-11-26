/**
 * Whether a stage move goes backward (seen-merchant-trial-test-2026-11-26.md,
 * phase 3 item 6): such a move is confirmed first. Men's tailoring by its
 * fixed order; another vertical by the order of its own stages. Cancelling
 * has its own confirmation and is not counted here.
 */
const FIXED = ['measurements_taken', 'cutting', 'sewing', 'embroidery', 'ironing_packaging', 'ready', 'partial_delivered', 'delivered'];

export function isBackwardMove(current: string, target: string, stages: ReadonlyArray<{ stage_key: string }>): boolean {
  if (target === 'cancelled' || current === target) return false;
  const order = stages.length > 0 ? stages.map((s) => s.stage_key) : FIXED;
  const from = order.indexOf(current);
  const to = order.indexOf(target);
  return from >= 0 && to >= 0 && to < from;
}
