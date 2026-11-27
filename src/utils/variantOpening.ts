/**
 * The opening balance of a product with variants
 * (seen-product-variants-barcode-po-price-task.md, phase 3, question 5):
 *   (a) "same"  -- the number is each variant's;
 *   (b) "split" -- the number is shared: pieces in whole units, the rest to
 *       the first variants in order (10 on 3 = 4, 3, 3); metres to two
 *       decimals, the difference on the last so the sum is exact.
 * A variant set by hand (pinned) keeps its number; in (b) the others share
 * what is left.
 */
export interface AllocateInput {
  total: number;
  count: number;
  mode: 'same' | 'split';
  /** Pieces (true) or metres and other fractional units (false). */
  wholeUnits: boolean;
  /** index -> the number set by hand for that variant. */
  pinned?: Record<number, number>;
}

export function allocateOpening({ total, count, mode, wholeUnits, pinned = {} }: AllocateInput): number[] {
  const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const t = safe(total);
  const isPinned = (i: number) => Object.prototype.hasOwnProperty.call(pinned, i);
  if (mode === 'same') {
    return Array.from({ length: count }, (_, i) => (isPinned(i) ? safe(pinned[i]) : t));
  }

  const free = Array.from({ length: count }, (_, i) => i).filter((i) => !isPinned(i));
  const pinnedSum = Object.keys(pinned).reduce((s, k) => s + safe(pinned[Number(k)]), 0);
  const left = Math.max(0, t - pinnedSum);
  const out = Array.from({ length: count }, (_, i) => (isPinned(i) ? safe(pinned[i]) : 0));
  if (free.length === 0) return out;

  if (wholeUnits) {
    const whole = Math.floor(left);
    const base = Math.floor(whole / free.length);
    let rest = whole - base * free.length;
    free.forEach((i) => { out[i] = base + (rest > 0 ? 1 : 0); if (rest > 0) rest -= 1; });
    return out;
  }

  const cents = Math.round(left * 100);
  const base = Math.floor(cents / free.length);
  free.forEach((i, n) => { out[i] = (n === free.length - 1 ? cents - base * (free.length - 1) : base) / 100; });
  return out;
}
