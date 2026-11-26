/**
 * A garment's components -- buttons, thread -- taken from stock with its
 * cloth at cutting (seen-merchant-trial-test-2026-11-26.md, phase 2 item 2,
 * question 2's default). The shop keeps them once per garment type
 * (garment_components); the cutting dialog shows them, times the pieces,
 * and update_order_status_with_components takes them once per order.
 */

export interface GarmentComponentDefault {
  garment_type: string;
  item_id: string;
  quantity: number;
  item_name?: string | null;
}

export interface CuttingComponent {
  itemId: string;
  name: string;
  quantity: number;
}

const typeOf = (item: Record<string, any>): string => String(item?.garmentType || item?.name || '').trim();

/** The order's garment types, trimmed, once each. */
export function garmentTypesOf(items: ReadonlyArray<Record<string, any>> | null | undefined): string[] {
  return Array.from(new Set((items || []).map(typeOf).filter(Boolean)));
}

/** The shop's defaults for the order's garments, times their pieces, summed per item. */
export function defaultComponentsFor(
  items: ReadonlyArray<Record<string, any>> | null | undefined,
  defaults: ReadonlyArray<GarmentComponentDefault>,
): CuttingComponent[] {
  const totals = new Map<string, CuttingComponent>();
  for (const item of items || []) {
    const type = typeOf(item);
    if (!type) continue;
    const pieces = Math.max(1, Number(item?.quantity) || 1);
    for (const d of defaults) {
      if (String(d.garment_type).trim() !== type) continue;
      const prev = totals.get(d.item_id);
      const add = Number(d.quantity) * pieces;
      totals.set(d.item_id, { itemId: d.item_id, name: prev?.name || d.item_name || '', quantity: (prev?.quantity || 0) + add });
    }
  }
  return Array.from(totals.values());
}

const RANK: Record<string, number> = {
  measurements_taken: 0, cutting: 1, sewing: 2, embroidery: 3, ironing_packaging: 4, ready: 5, partial_delivered: 6, delivered: 7,
};

/** The first move to cutting or past it, until the components are taken (orders.components_taken_at). */
export function isComponentsDue(input: { currentStatus: string; targetStatus: string; componentsTakenAt?: string | null }): boolean {
  if (input.componentsTakenAt) return false;
  const target = RANK[input.targetStatus];
  return target !== undefined && target >= RANK.cutting;
}
