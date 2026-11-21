/**
 * Selling by length at the POS (seen-verticals-readiness-task.md Phase 5): a
 * fabric store sells 2.5 m, not "1 piece". The cart line's quantity is always
 * in metres -- the unit the stock is kept in (receiving adds quantity x
 * conversion_rate) and the unit a fabric's price is set per («سعر البيع
 * للمتر») -- so create_pos_sale deducts and prices it as it is. The cashier
 * may type yards or pick a whole roll; both turn into metres here.
 */
import { METERS_PER_YARD } from './fabricUomConverter';

/** The ± step and the smallest sale, in metres. */
export const LENGTH_STEP_METERS = 0.25;

export type LengthUnit = 'meter' | 'yard' | 'roll';

/** Metres rounded to the centimetre. */
export const roundMeters = (m: number) => Math.round(m * 100) / 100;

/** The line after a ± press: one step up or down, never under one step. */
export function stepMeters(current: number, direction: 1 | -1, step = LENGTH_STEP_METERS): number {
  return Math.max(step, roundMeters((Number(current) || 0) + direction * step));
}

/** What the cashier typed, in the unit they chose, as metres (null when not a positive number). */
export function toMeters(value: number, unit: LengthUnit, metersPerRoll: number): number | null {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (unit === 'yard') return roundMeters(v * METERS_PER_YARD);
  if (unit === 'roll') return metersPerRoll > 0 ? roundMeters(v * metersPerRoll) : null;
  return roundMeters(v);
}

/** Metres shown back in the chosen unit. */
export function fromMeters(meters: number, unit: LengthUnit, metersPerRoll: number): number {
  if (unit === 'yard') return roundMeters(meters / METERS_PER_YARD);
  if (unit === 'roll') return metersPerRoll > 0 ? roundMeters(meters / metersPerRoll) : meters;
  return roundMeters(meters);
}

/** The first quantity of a length line: one metre, or what is left if less. */
export function firstLengthQuantity(availableMeters: number): number {
  return roundMeters(Math.min(1, Math.max(0, availableMeters)));
}
