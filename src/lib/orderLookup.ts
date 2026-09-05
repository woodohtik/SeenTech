/**
 * orderLookup.ts — manual "add order" fallback for the customer app's "My
 * Orders" screen, by order number + last 4 digits of the customer's phone
 * (POST /api/public/order-lookup), instead of the raw tracking_token
 * (impractical to retype -- a 36-char UUID). See the server route's own
 * comment for the security reasoning behind requiring both together.
 */
import { apiUrl } from './apiBase';

export async function lookupOrderByInvoiceAndPhone(
  orderNumber: string,
  phoneLast4: string
): Promise<string | null> {
  try {
    const res = await fetch(apiUrl('/api/public/order-lookup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNumber, phoneLast4 }),
    });
    if (!res.ok) return null;
    const row = await res.json();
    return typeof row.tracking_token === 'string' ? row.tracking_token : null;
  } catch {
    return null;
  }
}
