/**
 * seen-responsive-layout-task.md, acceptance criterion 7: one HTML page for
 * the founder with before / after shots of every screen at 360, 1024, 1280
 * (with the assistant) and 1920, and the check counts.
 *
 *   npx tsx scripts/responsive/report.ts [--before baseline] [--after after]
 *
 * Reads docs/responsive/<label>/results.json and shots/, writes
 * docs/responsive/report.html. The page links the shots by relative path, so
 * it opens straight from the folder.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'docs/responsive');
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const BEFORE = arg('before', 'baseline');
const AFTER = arg('after', 'after');

type Row = { screen: string; width: number; dir: string; sidebar: string; assistant: string; failures: string[]; shot?: string; report?: { mainWidth: number | null; title: { lines: number } } };
type Results = { rows: Row[]; totals: { states: number; failing: number; byCheck: Record<string, number> } };
const load = (label: string): Results => JSON.parse(readFileSync(path.join(DIR, label, 'results.json'), 'utf8'));
const before = load(BEFORE);
const after = load(AFTER);

const SCREENS: [string, string][] = [
  ['dashboard', 'لوحة التحكم'], ['pos', 'نقطة البيع'], ['orders', 'الطلبات'], ['order-new', 'طلب تفصيل جديد'],
  ['customers', 'العملاء'], ['inventory', 'المخزون'], ['reports', 'التقارير'], ['settings', 'الإعدادات'],
];
const CHECKS: [string, string][] = [
  ['text under 14px', 'نص أصغر من 14px'], ['touch targets under 44px', 'هدف لمس أصغر من 44px'], ['overflow', 'عنصر يخرج من مكانه أو يُقص'],
  ['text over text', 'نص فوق نص'], ['a word a line', 'كلمة في كل سطر'], ['horizontal scroll', 'تمرير أفقي للصفحة'],
  ['title word split across lines', 'كلمة العنوان مكسورة'], ['could not reach this state', 'حالة لم تُفتح'],
];
const SLOTS: { width: number; kind: string; label: string }[] = [
  { width: 360, kind: 'page', label: 'جوال 360px' },
  { width: 1024, kind: 'page', label: 'تابلت أفقي 1024px' },
  { width: 1280, kind: 'assistant-open', label: 'لابتوب 1280px والمساعد مفتوح' },
  { width: 1920, kind: 'page', label: 'شاشة 1920px' },
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const failuresArabic = (f: string[]) => f.length
  ? f.map((x) => { const key = CHECKS.find(([k]) => x.startsWith(k)); const n = x.match(/x(\d+)$/); return key ? `${key[1]}${n ? ` ×${n[1]}` : ''}` : x; }).join('، ')
  : 'لا ملاحظات';
const rowFor = (res: Results, screen: string, width: number, kind: string) => res.rows.find((r) =>
  r.screen === screen && r.width === width && r.dir === 'rtl' && r.sidebar === 'open' &&
  (kind === 'page' ? r.assistant === 'closed' : r.assistant === kind.replace('assistant-', '')));

function shot(label: string, screen: string, width: number, kind: string) {
  const rel = `${label}/shots/${screen}-${width}-rtl-${kind}.jpg`;
  return existsSync(path.join(DIR, rel)) ? rel : null;
}

function figure(label: string, res: Results, screen: string, slot: typeof SLOTS[number], tag: string) {
  // A screen that is a window covers the assistant's launcher: shown without it.
  const kind = shot(label, screen, slot.width, slot.kind) ? slot.kind : 'page';
  const src = shot(label, screen, slot.width, kind);
  const row = rowFor(res, screen, slot.width, kind);
  const meta = row?.report ? `عرض المحتوى ${row.report.mainWidth}px، العنوان ${row.report.title.lines === 1 ? 'سطر واحد' : `${row.report.title.lines} أسطر`}` : '';
  const ok = row && row.failures.length === 0;
  return `<figure class="shot">
    <figcaption><span class="tag ${tag}">${tag === 'before' ? 'قبل' : 'بعد'}</span><span class="state ${ok ? 'ok' : 'bad'}">${esc(failuresArabic(row?.failures ?? ['—']))}</span></figcaption>
    ${src ? `<a href="${src}" target="_blank" rel="noopener"><img loading="lazy" src="${src}" alt="${esc(`${tag === 'before' ? 'قبل' : 'بعد'}: ${slot.label}`)}" width="${Math.min(slot.width, 640)}"></a>` : '<p class="missing">لا لقطة</p>'}
    ${meta ? `<p class="meta">${meta}</p>` : ''}
  </figure>`;
}

const countBy = (res: Results, key: string) => res.totals.byCheck[key] ?? 0;
const summaryRows = CHECKS.filter(([k]) => countBy(before, k) || countBy(after, k))
  .map(([k, ar]) => `<tr><th scope="row">${ar}</th><td>${countBy(before, k)}</td><td>${countBy(after, k)}</td></tr>`).join('');

const screensHtml = SCREENS.map(([key, name]) => `
  <section class="screen" id="${key}">
    <h2>${name}</h2>
    ${SLOTS.map((slot) => `
      <div class="pair">
        <h3>${slot.label}</h3>
        <div class="grid">${figure(BEFORE, before, key, slot, 'before')}${figure(AFTER, after, key, slot, 'after')}</div>
      </div>`).join('')}
  </section>`).join('');

const founder = (res: Results) => rowFor(res, 'dashboard', 1280, 'assistant-open');
const fb = founder(before); const fa = founder(after);

const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>سين — العرض المرن: قبل وبعد</title>
<style>
  :root { --ink: #0E2A42; --muted: #686E74; --wash: #EBEDEF; --line: #D6D9DD; --blue: #0F6E96; --ok: #018256; --bad: #CE0500; --surface: #FFFFFF; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--wash); color: var(--ink); font: 400 18px/1.7 "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif; }
  h1, h2, h3 { font-family: "Tajawal", "IBM Plex Sans Arabic", sans-serif; line-height: 1.3; margin: 0; }
  header.top { background: var(--ink); color: #fff; padding: 40px 16px; }
  header.top .in, main { max-width: 1280px; margin: 0 auto; }
  header.top h1 { font-size: 36px; font-weight: 800; }
  header.top p { color: #cfe0f2; margin: 8px 0 0; max-width: 70ch; }
  main { padding: 24px 16px 64px; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 24px; margin-bottom: 24px; }
  .lead { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); }
  .big { font: 800 44px/1.1 "Tajawal", sans-serif; font-variant-numeric: tabular-nums; }
  .big small { font-size: 18px; color: var(--muted); font-weight: 500; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { text-align: start; padding: 10px 12px; border-bottom: 1px solid var(--line); }
  thead th { color: var(--muted); font-weight: 600; font-size: 16px; }
  td { font-weight: 700; }
  nav.toc { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; }
  nav.toc a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 9999px; background: var(--surface); border: 1px solid var(--line); color: var(--ink); text-decoration: none; font-weight: 600; }
  nav.toc a:focus-visible, a:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
  .screen { margin-top: 40px; }
  .screen > h2 { font-size: 28px; font-weight: 800; margin-bottom: 16px; }
  .pair { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  .pair h3 { font-size: 18px; font-weight: 700; margin-bottom: 12px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr)); }
  figure { margin: 0; }
  figcaption { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 16px; }
  .tag { display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 6px; font-weight: 700; }
  .tag.before { background: #f3f4f6; color: var(--muted); }
  .tag.after { background: #e6f1f6; color: var(--blue); }
  .state.ok { color: var(--ok); font-weight: 600; }
  .state.bad { color: var(--bad); font-weight: 600; }
  img { display: block; max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
  .meta { margin: 6px 0 0; color: var(--muted); font-size: 16px; }
  .missing { color: var(--muted); }
  .note { color: var(--muted); font-size: 16px; margin: 12px 0 0; }
</style>
</head>
<body>
<header class="top"><div class="in">
  <h1>العرض المرن في سين: قبل وبعد</h1>
  <p>كل لقطة من نسخة الفرع نفسها، على بيانات تجريبية ثابتة (لا حساب حقيقي ولا بيانات محل حقيقي). «قبل» من الكود قبل المهمة، و«بعد» من آخر نسخة على الفرع <code>feat/responsive-layout</code>.</p>
</div></header>
<main>
  <section class="card">
    <h2 style="font-size:28px;margin-bottom:16px">حالتك: لابتوب 1280px والمساعد مفتوح</h2>
    <div class="lead">
      <div><div class="big">${fb?.report?.mainWidth ?? '—'}px <small>عرض لوحة التحكم قبل</small></div><p class="note">العنوان ${fb?.report?.title.lines ?? '—'} أسطر. ${esc(failuresArabic(fb?.failures ?? []))}</p></div>
      <div><div class="big">${fa?.report?.mainWidth ?? '—'}px <small>عرضها بعد</small></div><p class="note">العنوان ${fa?.report?.title.lines === 1 ? 'سطر واحد' : `${fa?.report?.title.lines ?? '—'} أسطر`}. المساعد يطفو فوق الصفحة ولا يضغطها. ${esc(failuresArabic(fa?.failures ?? []))}</p></div>
    </div>
  </section>

  <section class="card">
    <h2 style="font-size:28px;margin-bottom:16px">الفحوص الآلية على كل الحالات</h2>
    <p class="note" style="margin:0 0 12px">8 شاشات × 9 عروض × المساعد مغلق/مفتوح/موسّع × القائمة مفتوحة/مطوية، مع عينة بالإنجليزي وفحص 320px. الرقم = عدد الحالات التي فشل فيها الفحص.</p>
    <table>
      <thead><tr><th scope="col">الفحص</th><th scope="col">قبل</th><th scope="col">بعد</th></tr></thead>
      <tbody>${summaryRows}<tr><th scope="row">حالات فيها ملاحظة واحدة على الأقل</th><td>${before.totals.failing} من ${before.totals.states}</td><td>${after.totals.failing} من ${after.totals.states}</td></tr></tbody>
    </table>
  </section>

  <nav class="toc" aria-label="الشاشات">${SCREENS.map(([k, n]) => `<a href="#${k}">${n}</a>`).join('')}</nav>
  ${screensHtml}
</main>
</body>
</html>
`;
writeFileSync(path.join(DIR, 'report.html'), html);
console.log(`docs/responsive/report.html: ${SCREENS.length} screens, before ${before.totals.failing}/${before.totals.states}, after ${after.totals.failing}/${after.totals.states}`);
