/**
 * What the assistant is told about the moment it is asked in: the page the
 * person has open and today's date in Riyadh. Pure, so it is tested alone.
 *
 * The page arrives from the browser, so it is only ever matched against the
 * fixed list below: an unknown value adds nothing to the prompt, and no text
 * from the request is ever copied into it.
 */

export const SHOP_TIME_ZONE = 'Asia/Riyadh';

const PAGES: Record<string, { name: string; path: string }> = {
  home: { name: 'لوحة التحكم', path: '/dashboard' },
  sales: { name: 'المبيعات / نقطة البيع', path: '/sales' },
  orders: { name: 'الطلبات', path: '/orders' },
  customers: { name: 'العملاء', path: '/customers' },
  inventory: { name: 'المخزون', path: '/inventory' },
  suppliers: { name: 'الموردين والمشتريات', path: '/suppliers' },
  reports: { name: 'التقارير', path: '/reports' },
  settings: { name: 'الإعدادات', path: '/settings' },
};

/** Today's calendar date in the shop's time zone, YYYY-MM-DD. */
export function shopToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return now.toLocaleDateString('en-CA', { timeZone: SHOP_TIME_ZONE });
}

/** The date `days` before or after `date` (YYYY-MM-DD), as YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** The page key if it is one we know, otherwise null. */
export function knownPage(page: unknown): string | null {
  return typeof page === 'string' && Object.prototype.hasOwnProperty.call(PAGES, page) ? page : null;
}

/**
 * The lines appended to the system prompt: today's date (with yesterday and
 * the weekday, so "today" and "yesterday" are never guessed) and, when known,
 * the page the person is looking at.
 */
export function buildMomentContext(page: unknown, now: Date = new Date()): string {
  const today = shopToday(now);
  const weekday = now.toLocaleDateString('ar-SA-u-ca-gregory', { timeZone: SHOP_TIME_ZONE, weekday: 'long' });
  const lines = [
    `تاريخ اليوم بتوقيت الرياض: ${today} (${weekday})، والأمس ${addDays(today, -1)}. استعمل هذين التاريخين عندما يقول المستخدم «اليوم» أو «أمس» أو «هذا الشهر»، ولا تخمّن التاريخ أبداً.`,
  ];
  const key = knownPage(page);
  if (key) {
    const { name, path } = PAGES[key];
    lines.push(`المستخدم يفتح الآن صفحة «${name}» (${path}). إذا قال «هذه الصفحة» أو «هنا» فهو يقصدها، وابدأ بما يخصّها عندما يكون سؤاله عاماً.`);
  }
  return lines.join('\n');
}
