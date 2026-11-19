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
