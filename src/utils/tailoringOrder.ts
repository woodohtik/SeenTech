import { resolveTaxSettings } from './taxSettings';
import { computeTaxDocument } from '../shared/taxEngine';
import { contentToMeters, metersToContent, type ContentUnit } from './fabricUomConverter';

/** Pure helpers behind the tailoring order form: tax, totals, and each line's fabric. */

export interface TailoringTax {
  enabled: boolean;
  /** Percentage, e.g. 15. */
  vatRatePercentage: number;
  taxType: 'inclusive' | 'exclusive' | 'exempt';
}

/**
 * A shop's tailoring tax rules out of its `tenants` row: utils/taxSettings.ts
 * resolveTaxSettings, the same rules as the database's tenant_tax_rules that
 * create_tailoring_order applies.
 */
export function resolveTailoringTax(tenantRow: any): TailoringTax {
  const s = resolveTaxSettings(tenantRow);
  return { enabled: s.enabled, vatRatePercentage: s.vatRate, taxType: s.tailoringTaxType };
}

export interface TailoringTotals {
  /** Sum of price x pieces as entered, before discount (and before tax when prices exclude it). */
  itemsTotal: number;
  /** Discount actually taken off the total (never more than it). */
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
  // seen-readiness-fixes-task.md P1.1: the one tax engine, the same rules as
  // create_tailoring_order: every line takes the shop's tailoring tax type,
  // and the discount comes off what the customer pays (as in the POS).
  const effectiveType = tax.enabled ? tax.taxType : 'exempt';
  const rate = effectiveType === 'exempt' ? 0 : tax.vatRatePercentage / 100;
  const doc = computeTaxDocument({
    lines: items.map((item) => ({ price: Number(item.price) || 0, quantity: Number(item.quantity) || 0, taxType: effectiveType })),
    rate,
    discountType: 'fixed',
    discountValue: Math.max(Number(discountAmount) || 0, 0),
  });
  return {
    itemsTotal: items.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity) || 0), 0),
    discount: doc.discountGross,
    subtotal: doc.subtotal,
    vat: doc.tax,
    total: doc.total,
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

// ---- the server shape of a line (order_items) ----

/** Style fields a line carries, as [form key, order_items column]. */
const LINE_STYLE_COLUMNS = [
  ['collarType', 'collar_type'],
  ['cuffType', 'cuff_type'],
  ['pocketType', 'pocket_type'],
  ['chestStyle', 'chest_style'],
  ['shoulderStyle', 'shoulder_style'],
  ['cuttingType', 'cutting_type'],
  ['collarPadding', 'collar_padding'],
  ['closureType', 'closure_type'],
  ['closureVisibility', 'closure_visibility'],
  ['additions', 'additions'],
  ['embroidery', 'embroidery'],
] as const;

/** A form line as create_tailoring_order expects it in p_items. */
export function lineToServerItem(line: Record<string, any>): Record<string, unknown> {
  const item: Record<string, unknown> = {
    garment_type: line.garmentType,
    fabric: line.fabric || '',
    fabric_id: line.fabricId || '',
    quantity: Math.max(1, Math.floor(Number(line.quantity) || 1)),
    price: Number(line.price) || 0,
    consumed_meters: Number(line.consumedMeters) || 0,
    // What has no column of its own rides in attributes, beside the
    // activity's own dynamic fields.
    attributes: {
      ...(line.attributes && typeof line.attributes === 'object' ? line.attributes : {}),
      quantityUnit: 'piece',
      fabricManual: Boolean(line.fabricManual),
      fabricPerPieceMeters: Number(line.fabricPerPieceMeters) || 0,
    },
  };
  for (const [key, column] of LINE_STYLE_COLUMNS) item[column] = line[key] ?? '';
  return item;
}

/** An order_items row as the line shape the order screens have always read. */
export function orderItemRowToLine(row: Record<string, any>): Record<string, any> {
  const attributes = row.attributes && typeof row.attributes === 'object' ? row.attributes : {};
  const line: Record<string, any> = {
    id: row.id,
    type: row.type || 'custom',
    garmentType: row.garment_type || row.name || '',
    name: row.name || row.garment_type || '',
    fabric: row.fabric || '',
    fabricId: row.fabric_id || '',
    quantity: Number(row.quantity) || 0,
    price: Number(row.price) || 0,
    consumedMeters: Number(row.consumed_meters) || 0,
    // seen-cutting-fabric-pos-orders-fix-task.md: what the line took from stock (a POS sale takes it at the sale).
    fabricTakenMeters: Number(row.fabric_taken_meters) || 0,
    quantityUnit: attributes.quantityUnit,
    fabricManual: Boolean(attributes.fabricManual),
    fabricPerPieceMeters: Number(attributes.fabricPerPieceMeters) || 0,
    attributes,
    // The customer's measurements as they were when the order was made.
    measurements: row.measurements && typeof row.measurements === 'object' ? row.measurements : {},
    status: row.status_key || row.status,
  };
  for (const [key, column] of LINE_STYLE_COLUMNS) {
    if (row[column] !== null && row[column] !== undefined) line[key] = row[column];
  }
  return line;
}

// ---- fabric deduction at the cutting stage ----

/** The fixed order_status enum, in working order. `cancelled` is not a stage. */
const STAGE_RANK: Record<string, number> = {
  measurements_taken: 0,
  cutting: 1,
  sewing: 2,
  embroidery: 3,
  ironing_packaging: 4,
  ready: 5,
  partial_delivered: 6,
  delivered: 7,
};

/**
 * Whether moving an order to `targetStatus` is the move that takes its fabric
 * from stock: the first time it reaches cutting or any later stage. Both
 * statuses are the fixed enum values (see legacyOrderStatusFor).
 */
export function isFabricDeductionDue(input: {
  currentStatus: string;
  targetStatus: string;
  fabricDeductedAt?: string | null;
  /** 'tailoring' for an order saved through create_tailoring_order. */
  kind?: string | null;
}): boolean {
  if (input.fabricDeductedAt) return false;
  const target = STAGE_RANK[input.targetStatus];
  if (target === undefined || target < STAGE_RANK.cutting) return false;
  // The server stamps a tailoring-kind order (and a POS sale) only after a
  // real deduction, so one that passed cutting with no figure entered is
  // still due at its next move.
  if (input.kind === 'tailoring' || input.kind === 'pos_sale') return true;
  // An older order carries no stamp: its fabric was handled when it reached
  // cutting, so only the move that first takes it there is due.
  const current = STAGE_RANK[input.currentStatus];
  return current === undefined || current < STAGE_RANK.cutting;
}

/**
 * seen-cutting-fabric-pos-orders-fix-task.md question 1: a thobe sold from
 * the POS whose cloth was taken at the sale. The move that first takes it
 * to cutting offers the cutting window (not forced): the tailor may enter
 * the real figure, and only the difference moves.
 */
export function isFabricReviewOffered(input: {
  currentStatus: string;
  targetStatus: string;
  fabricDeductedAt?: string | null;
  kind?: string | null;
}): boolean {
  if (input.kind !== 'pos_sale' || !input.fabricDeductedAt) return false;
  const target = STAGE_RANK[input.targetStatus];
  const current = STAGE_RANK[input.currentStatus];
  if (target === undefined || target < STAGE_RANK.cutting) return false;
  return current === undefined || current < STAGE_RANK.cutting;
}

export interface CuttingFabricLine {
  /** order_items id for an order saved through create_tailoring_order; the line's position otherwise. */
  lineKey: string;
  fabricId: string;
  fabricName: string;
  garmentType: string;
  pieces: number;
  /** The figure saved with the line, in meters. */
  meters: number;
  /** Already taken from stock for this line (a POS sale at the sale); cutting moves only the difference. */
  takenMeters?: number;
}

/** The lines of an order that draw cloth from stock, for the cutting dialog. */
export function cuttingFabricLines(items: ReadonlyArray<Record<string, any>> | null | undefined): CuttingFabricLine[] {
  return (items || []).flatMap((item, index) => {
    // The customer's own cloth, and old lines that never recorded which
    // stock item they used, have nothing to deduct.
    if (!item?.fabricId || item.fabric === 'custom') return [];
    return [{
      lineKey: item.id ? String(item.id) : `idx-${index}`,
      fabricId: String(item.fabricId),
      fabricName: item.fabric || '',
      garmentType: item.garmentType || item.name || '',
      pieces: Number(item.quantity) || 0,
      meters: Math.max(0, Number(item.consumedMeters) || 0),
      // Only when the line took cloth already (a POS sale at the sale).
      ...(Number(item.fabricTakenMeters) > 0 ? { takenMeters: Number(item.fabricTakenMeters) } : {}),
    }];
  });
}
