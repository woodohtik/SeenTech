/**
 * seen-readiness-fixes-task.md P5 (PLATFORM-06; founder question 7, default):
 * a printable receipt for a subscription payment to Seen. Seen is not
 * registered for VAT, so this is a receipt only -- it never calls itself a
 * tax invoice and carries no VAT number or tax breakdown. When Seen
 * registers, this is where a real tax invoice would replace it.
 */
export type SubscriptionPayment = {
  id: string;
  receipt_number: string;
  plan_name: string | null;
  amount: number | string;
  original_amount?: number | string | null;
  discount_amount?: number | string | null;
  payment_method: string | null;
  reference: string | null;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
};

export type ReceiptLabels = {
  title: string;
  notTaxInvoice: string;
  receiptNo: string;
  date: string;
  shop: string;
  plan: string;
  period: string;
  method: string;
  reference: string;
  discount: string;
  total: string;
  issuer: string;
};

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const money = (v: unknown) => `${Number(v ?? 0).toFixed(2)} SAR`;

export function subscriptionReceiptHtml(
  p: SubscriptionPayment,
  opts: { shopName: string; locale: string; dir: 'rtl' | 'ltr'; labels: ReceiptLabels; methodLabel: string },
): string {
  const { labels: L } = opts;
  const day = (v: string | null) => (v ? new Date(v).toLocaleDateString(opts.locale, { year: 'numeric', month: 'long', day: 'numeric' }) : '—');
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  const discount = Number(p.discount_amount ?? 0);
  return `<!doctype html><html dir="${opts.dir}" lang="${esc(opts.locale.slice(0, 2))}"><head><meta charset="utf-8"><title>${esc(L.title)} ${esc(p.receipt_number)}</title>
<style>body{font-family:Tajawal,Arial,sans-serif;margin:32px;color:#111}h1{font-size:20px;margin:0 0 4px}.note{border:2px solid #b45309;color:#7c2d12;padding:8px 12px;border-radius:8px;font-weight:700;margin:12px 0}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:start}th{width:40%;color:#444}.total td,.total th{font-size:18px;font-weight:800}</style></head>
<body><h1>${esc(L.title)}</h1><div>${esc(L.issuer)}</div><p class="note">${esc(L.notTaxInvoice)}</p><table>
${row(L.receiptNo, p.receipt_number)}${row(L.date, day(p.created_at))}${row(L.shop, opts.shopName)}${row(L.plan, p.plan_name || '—')}
${row(L.period, p.period_start && p.period_end ? `${day(p.period_start)} — ${day(p.period_end)}` : '—')}${row(L.method, opts.methodLabel)}${row(L.reference, p.reference || '—')}
${discount > 0 ? row(L.discount, money(discount)) : ''}<tr class="total"><th>${esc(L.total)}</th><td>${esc(money(p.amount))}</td></tr></table>
</body></html>`;
}

export function printSubscriptionReceipt(html: string): boolean {
  // Every value in html went through esc(); the window is ours (about:blank).
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
  return true;
}
