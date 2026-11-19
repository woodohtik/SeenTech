import { calculateItemTax } from './b2bHelper';
import { contentToMeters, metersToContent, type ContentUnit } from './fabricUomConverter';

/** Pure helpers behind the tailoring order form: tax, totals, and each line's fabric. */

export interface TailoringTax {
  enabled: boolean;
  /** Percentage, e.g. 15. */
  vatRatePercentage: number;
  taxType: 'inclusive' | 'exclusive' | 'exempt';
}

/** A shop's tailoring tax rules out of its `tenants` row (same rules the Orders page always used). */
export function resolveTailoringTax(tenantRow: any): TailoringTax {
  const raw = tenantRow?.tax_settings;
  const hasVat = Boolean(tenantRow?.vat_number && String(tenantRow.vat_number).trim().length > 0);
  const enabled = raw ? Boolean(raw.enabled ?? (hasVat || Boolean(raw.trn))) : hasVat;
  return {
    enabled,
    vatRatePercentage: Number(raw?.vatRate ?? 15) || 15,
    taxType: raw?.tailoringTaxType || 'exclusive',
  };
}

export interface TailoringTotals {
  /** Sum of price x pieces, before discount and tax. */
  itemsTotal: number;
  /** Discount actually applied (never more than the items total). */
  discount: number;
  subtotal: number;
  vat: number;
  total: number;
  /** Stored on the order: 0 when tax is off or exempt. */
  taxRate: number;
}

export function computeTailoringTotals(
  items: ReadonlyArray<{ price?: unknown; quantity?: unknown }>,
  discountAmount: unknown,
  tax: TailoringTax
): TailoringTotals {
  const itemsTotal = items.reduce(
    (sum, item) => sum + (Number(item.price) * Number(item.quantity) || 0),
    0
  );
  const discount = Math.min(Math.max(Number(discountAmount) || 0, 0), itemsTotal);
  const effectiveType = tax.enabled ? tax.taxType : 'exempt';
  const { basePrice, taxAmount, finalPrice } = calculateItemTax(
    itemsTotal - discount,
    effectiveType,
    tax.vatRatePercentage / 100,
    1
  );
  return {
    itemsTotal,
    discount,
    subtotal: basePrice,
    vat: taxAmount,
    total: finalPrice,
    taxRate: effectiveType === 'exempt' ? 0 : tax.vatRatePercentage,
  };
}

export interface LineFabricInput {
  /** Estimated fabric for one piece in meters, or null when it cannot be estimated. */
  perPieceMeters: number | null;
  /** Whole pieces on the line. */
  quantity: unknown;
  /** The staff member typed the total themselves. */
  isManual?: boolean;
  /** The typed total, in meters. */
  manualMeters?: unknown;
  /** The customer's own cloth: shown as information, never deducted. */
  isExternal?: boolean;
}

export interface LineFabric {
  perPieceMeters: number | null;
  /** perPiece x pieces, or null without an estimate. */
  computedMeters: number | null;
  /** What the line shows as its total. */
  totalMeters: number | null;
  isManual: boolean;
  /** What is saved for the cutting-stage deduction; 0 for external cloth or no figure. */
  consumedMeters: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeLineFabric(input: LineFabricInput): LineFabric {
  const pieces = Math.max(1, Math.floor(Number(input.quantity) || 1));
  const computedMeters = input.perPieceMeters === null ? null : round2(input.perPieceMeters * pieces);
  const manual = Number(input.manualMeters);
  const isManual = Boolean(input.isManual) && !input.isExternal && Number.isFinite(manual) && manual >= 0;
  const totalMeters = isManual ? round2(manual) : computedMeters;
  return {
    perPieceMeters: input.perPieceMeters,
    computedMeters,
    totalMeters,
    isManual,
    consumedMeters: input.isExternal ? 0 : (totalMeters ?? 0),
  };
}

/** A fabric quantity held in meters, shown in the unit the shop buys that cloth in. */
export function fabricInContentUnit(meters: number, contentUnit: ContentUnit | null | undefined): number {
  return contentUnit === 'yard' ? metersToContent(meters, 'yard') : round2(meters);
}

/** The reverse: what the staff member typed in the cloth's unit, as meters. */
export function fabricFromContentUnit(value: number, contentUnit: ContentUnit | null | undefined): number {
  return contentUnit === 'yard' ? round2(contentToMeters(value, 'yard')) : round2(value);
}
