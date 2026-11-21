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

/**
 * The shop's activity and its order stages, appended to the system prompt
 * (seen-verticals-readiness-task.md Phase 7.3), so "كم طلب في مرحلة
 * التنجيد؟" is answered with the shop's own stage names, and the stage key
 * the tools return is translated back to the name the shop sees.
 */
export function buildVerticalContext(
  verticalName: string | null | undefined,
  stages: ReadonlyArray<{ stage_key: string; label_ar: string; phase?: string | null }>,
): string {
  if (!verticalName && stages.length === 0) return '';
  const lines: string[] = [];
  if (verticalName) lines.push(`نشاط هذا المحل: «${verticalName}».`);
  const work = stages.filter((s) => s.phase !== 'cancelled');
  if (work.length > 0) {
    const list = work.map((s) => `${s.label_ar} (${s.stage_key})`).join('، ');
    lines.push(`مراحل الطلب في هذا المحل بالترتيب: ${list}. استعمل هذه التسميات بالضبط عند الحديث عن مراحل الطلبات، وحوّل أي مفتاح مرحلة تعيده الأدوات إلى تسميته.`);
  }
  return lines.join('\n');
}
