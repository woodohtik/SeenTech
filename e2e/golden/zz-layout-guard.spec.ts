import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * The layout guard (seen-ui-responsive-alignment-audit-task.md, phase 0):
 * every screen and form at 360 / 390 / 820 / 1024 / 1280 / 1440, measured
 * in the test shop (no real data). Run with GOLDEN_LAYOUT=1; it writes
 * golden-layout/report.json (+ a screenshot per screen) and, with
 * GOLDEN_LAYOUT_STRICT=1, fails on any "fail" finding -- strict once phases
 * 1-2 of the task are green.
 *
 * Fails: page wider than the window; two fields in one row whose tops differ
 * by > 2px (appendix A); a field not 48px tall; an open dialog without
 * role=dialog + aria-modal or with focus outside it; a button in an open
 * dialog covered by another fixed element; a tap target under 24px.
 * Warns: tap targets under 44px (at <= 1024), cut-off text.
 */
test.skip(!process.env.GOLDEN_LAYOUT, 'layout guard only with GOLDEN_LAYOUT=1');

const OUT = 'golden-layout';
const WIDTHS = [360, 390, 820, 1024, 1280, 1440] as const;
const HEIGHT: Record<number, number> = { 360: 740, 390: 844, 820: 1180, 1024: 768, 1280: 800, 1440: 900 };

type Finding = { width: number; screen: string; level: 'fail' | 'warn'; check: string; detail: string };
const findings: Finding[] = [];

const SCREENS: Array<{ name: string; url: string; open?: (p: Page) => Promise<unknown> }> = [
  { name: 'dashboard', url: '/dashboard' },
  { name: 'sales', url: '/sales' },
  { name: 'orders', url: '/orders' },
  { name: 'customers', url: '/customers' },
  { name: 'inventory', url: '/inventory' },
  { name: 'suppliers', url: '/suppliers' },
  { name: 'reports', url: '/reports' },
  { name: 'settings', url: '/settings' },
  { name: 'referral', url: '/referral' },
  { name: 'modal-new-po', url: '/suppliers', open: async (p) => {
    await p.getByRole('button', { name: 'المشتريات والمرتجعات' }).first().click();
    await p.getByRole('button', { name: 'إنشاء أمر شراء' }).first().click();
  } },
  { name: 'modal-new-order', url: '/orders', open: (p) => p.getByText('إنشاء طلب جديد').first().click() },
  { name: 'modal-add-product', url: '/inventory', open: (p) => p.getByRole('button', { name: 'إضافة منتج' }).first().click() },
  { name: 'modal-add-customer', url: '/customers', open: (p) => p.getByRole('button', { name: 'إضافة عميل جديد' }).first().click() },
  { name: 'modal-add-supplier', url: '/suppliers', open: (p) => p.getByRole('button', { name: /إضافة مورد/ }).first().click() },
  { name: 'modal-add-staff', url: '/settings?tab=staff', open: (p) => p.getByRole('button', { name: 'إضافة موظف' }).first().click() },
];

/** Runs in the page: the measurements (appendix A of the task, and the rest of phase 0). */
function measure(width: number) {
  const vis = (e: Element) => {
    const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const label = (e: Element) => ((e.getAttribute('aria-label') || (e as HTMLInputElement).placeholder || e.textContent || e.tagName) + '').trim().replace(/\s+/g, ' ').slice(0, 50);
  const out: Array<{ level: 'fail' | 'warn'; check: string; detail: string }> = [];

  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    out.push({ level: 'fail', check: 'horizontal-scroll', detail: `${document.documentElement.scrollWidth} > ${window.innerWidth}` });
  }

  // Who scrolls (finding 06): the page itself, not <main>, on a long screen.
  const main = document.querySelector('main');
  const pageScrolls = document.documentElement.scrollHeight > window.innerHeight + 1;
  if (main && !pageScrolls && main.scrollHeight > main.clientHeight + 1) {
    out.push({ level: 'warn', check: 'scroll-in-main', detail: `main ${main.scrollHeight}/${main.clientHeight}, page ${document.documentElement.scrollHeight}/${window.innerHeight}` });
  }

  // Scope to the open dialog, if one is open (else the page behind it counts).
  const overlays = [...document.querySelectorAll('[role=dialog],[aria-modal=true],.fixed.inset-0')].filter(vis);
  const top = overlays[overlays.length - 1] as HTMLElement | undefined;
  const root: Element = top ?? document.body;
  if (top) {
    const dialog = top.closest('[role=dialog]') ?? top.querySelector('[role=dialog]') ?? (top.getAttribute('role') === 'dialog' ? top : null);
    if (!dialog || dialog.getAttribute('aria-modal') !== 'true') out.push({ level: 'fail', check: 'dialog-role', detail: 'no role=dialog + aria-modal=true' });
    if (!root.contains(document.activeElement)) out.push({ level: 'fail', check: 'dialog-focus', detail: `focus on ${document.activeElement?.tagName}` });
    for (const b of [...root.querySelectorAll('button')].filter(vis)) {
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2; const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
      // Scrolled out of its scrolling panel: not visible, not covered.
      let clipped = false;
      for (let n = b.parentElement; n && n !== document.body; n = n.parentElement) {
        const st = getComputedStyle(n);
        if (/(auto|scroll|hidden)/.test(st.overflowY + st.overflowX)) {
          const pr = n.getBoundingClientRect();
          if (y < pr.top || y > pr.bottom || x < pr.left || x > pr.right) { clipped = true; break; }
        }
      }
      if (clipped) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && !b.contains(hit) && !root.contains(hit)) out.push({ level: 'fail', check: 'covered-button', detail: `«${label(b)}» under ${hit.tagName}.${(hit as HTMLElement).className?.toString().slice(0, 40)}` });
    }
  }

  const ctrls = [...root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]),select,[role=combobox],[data-field-control]')].filter(vis);
  const rows: Array<{ t: number; b: number; items: Array<{ r: DOMRect; e: Element }> }> = [];
  for (const c of ctrls) {
    const r = c.getBoundingClientRect();
    const row = rows.find((g) => r.top < g.b && r.bottom > g.t);
    if (row) { row.items.push({ r, e: c }); row.t = Math.min(row.t, r.top); row.b = Math.max(row.b, r.bottom); }
    else rows.push({ t: r.top, b: r.bottom, items: [{ r, e: c }] });
  }
  for (const g of rows.filter((x) => x.items.length > 1)) {
    const tops = g.items.map((i) => i.r.top);
    const d = Math.max(...tops) - Math.min(...tops);
    if (d > 2) out.push({ level: 'fail', check: 'misaligned-row', detail: `${Math.round(d)}px: ${g.items.map((i) => `«${label(i.e)}»@${Math.round(i.r.top)}`).join(' ')}` });
  }
  const heights: Record<string, number> = {};
  for (const c of ctrls) {
    if (c.tagName === 'TEXTAREA') continue;
    const h = Math.round(c.getBoundingClientRect().height);
    if (h !== 48) heights[h] = (heights[h] || 0) + 1;
  }
  if (Object.keys(heights).length) out.push({ level: 'fail', check: 'field-height', detail: `not 48: ${JSON.stringify(heights)}` });

  let small = 0; let under44 = 0; const smallNames: string[] = [];
  for (const t of [...root.querySelectorAll('button,a[href],[role=button],input[type=checkbox],input[type=radio]')].filter(vis)) {
    // A checkbox's tap area is its label; a 1px element is visually hidden (the skip link until focused).
    const box = (t.matches('input[type=checkbox],input[type=radio]') && t.closest('label')) || t;
    const r = box.getBoundingClientRect();
    if (r.width <= 1 && r.height <= 1) continue;
    if (r.width < 24 || r.height < 24) { small += 1; if (smallNames.length < 6) smallNames.push(`«${label(t)}» ${Math.round(r.width)}x${Math.round(r.height)}`); }
    else if (width <= 1024 && (r.width < 44 || r.height < 44)) under44 += 1;
  }
  if (small) out.push({ level: 'fail', check: 'target-under-24', detail: `${small}: ${smallNames.join(', ')}` });
  if (under44) out.push({ level: 'warn', check: 'target-under-44', detail: String(under44) });

  const cut: string[] = [];
  for (const e of [...root.querySelectorAll('*')]) {
    const s = getComputedStyle(e);
    if (s.textOverflow === 'ellipsis' && (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1 && vis(e)) cut.push(label(e));
  }
  if (cut.length) out.push({ level: 'warn', check: 'cut-text', detail: `${cut.length}: ${cut.slice(0, 6).map((c) => `«${c}»`).join(' ')}` });
  return out;
}

for (const width of WIDTHS) {
  test(`layout at ${width}`, async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width, height: HEIGHT[width] });
    page.setDefaultTimeout(8_000);
    await signIn(page, 'owner');
    for (const s of SCREENS) {
      try {
        await page.goto(s.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
        if (s.open) { await s.open(page); await page.waitForTimeout(1200); }
        for (const f of await page.evaluate(measure, width)) findings.push({ width, screen: s.name, ...f });
        const dir = path.join(OUT, String(width));
        mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: path.join(dir, `${s.name}.png`), fullPage: !s.open });
      } catch (e) {
        findings.push({ width, screen: s.name, level: 'warn', check: 'not-measured', detail: (e as Error).message.split('\n')[0] });
      }
    }
  });
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(findings, null, 2));
  const fails = findings.filter((f) => f.level === 'fail');
  const byCheck: Record<string, number> = {};
  for (const f of fails) byCheck[f.check] = (byCheck[f.check] || 0) + 1;
  console.log(`[layout] ${fails.length} fail, ${findings.length - fails.length} warn: ${JSON.stringify(byCheck)}`);
  if (process.env.GOLDEN_LAYOUT_STRICT) expect(fails, 'layout guard').toEqual([]);
});
