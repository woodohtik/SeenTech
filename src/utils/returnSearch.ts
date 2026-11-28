/**
 * Finding the sale to return (seen-stability-guardrails-task.md, found by
 * golden path 7): the box asks for the invoice number, so the number printed
 * on the receipt (INV-21, or just 21) finds its order -- besides the order
 * number, the end of its id, and the customer's phone.
 */

/** The ways an invoice number may be typed, as stored (INV-21). */
export function invoiceNumberCandidates(query: string): string[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const digits = q.replace(/^INV-?/, '');
  return Array.from(new Set([q, `INV-${digits}`, digits]));
}

export function matchesReturnSearch(
  order: { id: string; order_number?: number | string | null; customer_id?: string | null },
  query: string,
  found: { invoiceOrderIds: string[]; customerIds: string[] },
): boolean {
  const q = query.trim();
  if (!q) return false;
  return (
    found.invoiceOrderIds.includes(order.id)
    || order.id.includes(q)
    || order.id.slice(-6).toUpperCase() === q.toUpperCase()
    || order.order_number?.toString() === q
    || (!!order.customer_id && found.customerIds.includes(order.customer_id))
  );
}
