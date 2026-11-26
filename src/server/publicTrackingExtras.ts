/**
 * What the public tracking page adds to the stages
 * (seen-merchant-trial-test-2026-11-26.md, phase 2 item 5): the amount left
 * to pay, the shop's phone, and where to find it. The page is reached only by
 * the order's own unguessable token, sent to that customer.
 */
export interface TrackingOrderMoney { total_amount?: number | string | null; paid_amount?: number | string | null; remaining_amount?: number | string | null }
export interface TrackingShopContact { phone?: string | null; address?: string | null; city?: string | null }

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function publicTrackingExtras(order: TrackingOrderMoney, shop: TrackingShopContact | null | undefined) {
  const stored = num(order.remaining_amount);
  const remaining = stored !== null && Number.isFinite(stored)
    ? stored
    : (num(order.total_amount) || 0) - (num(order.paid_amount) || 0);
  const address = [text(shop?.address), text(shop?.city)].filter(Boolean).join('، ') || null;
  return {
    remaining_amount: Math.max(0, Math.round(remaining * 100) / 100),
    shop_phone: text(shop?.phone),
    shop_address: address,
    shop_map_url: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null,
  };
}
