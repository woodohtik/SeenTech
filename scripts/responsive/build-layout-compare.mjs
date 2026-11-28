// seen-ui-responsive-alignment-audit-task.md, phase 5: the before/after page.
//   node scripts/responsive/build-layout-compare.mjs <before-dir> <after-dir> <out.html>
// Each dir holds the layout guard's artifact: <width>/<screen>.png and report.json
// (e2e/golden/zz-layout-guard.spec.ts). The page links the images by relative path.
import fs from 'node:fs';
import path from 'node:path';

const [before, after, out] = process.argv.slice(2);
const WIDTHS = ['390', '820', '1024', '1280'];
const read = (d) => JSON.parse(fs.readFileSync(path.join(d, 'report.json'), 'utf8'));
const tally = (f) => {
  const fails = f.filter((x) => x.level === 'fail');
  const by = {};
  for (const x of fails) by[x.check] = (by[x.check] || 0) + 1;
  return { fails: fails.length, warns: f.length - fails.length, by };
};
const b = tally(read(before));
const a = tally(read(after));
const checks = [...new Set([...Object.keys(b.by), ...Object.keys(a.by)])].sort();
const rel = (p) => path.relative(path.dirname(out), p).split(path.sep).join('/');
const screens = fs.readdirSync(path.join(before, '1280')).filter((f) => f.endsWith('.png')).map((f) => f.replace(/\.png$/, '')).sort();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const rows = screens.map((s) => `
  <section>
    <h2>${esc(s)}</h2>
    ${WIDTHS.map((w) => `
    <div class="pair">
      <h3>${w}px</h3>
      <figure><figcaption>قبل</figcaption>${fs.existsSync(path.join(before, w, s + '.png')) ? `<img loading="lazy" src="${rel(path.join(before, w, s + '.png'))}" alt="${esc(s)} قبل، ${w}">` : '<p>—</p>'}</figure>
      <figure><figcaption>بعد</figcaption>${fs.existsSync(path.join(after, w, s + '.png')) ? `<img loading="lazy" src="${rel(path.join(after, w, s + '.png'))}" alt="${esc(s)} بعد، ${w}">` : '<p>—</p>'}</figure>
    </div>`).join('')}
  </section>`).join('');

const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>مقارنة التخطيط</title>
<style>
  :root { --bg: #f6f7f9; --card: #ffffff; --text: #1b1f24; --muted: #5b6470; --line: #dde1e6; --good: #0a7a3d; --bad: #b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #121417; --card: #1b1e22; --text: #eceff2; --muted: #a3acb6; --line: #2c3138; --good: #4fd18b; --bad: #ff8a80; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, "Segoe UI", Tahoma, sans-serif; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  p.lead { color: var(--muted); margin: 0 0 24px; }
  table { border-collapse: collapse; background: var(--card); border: 1px solid var(--line); margin-bottom: 32px; min-width: 320px; }
  th, td { padding: 8px 14px; border-bottom: 1px solid var(--line); text-align: start; font-variant-numeric: tabular-nums; }
  td.good { color: var(--good); font-weight: 700; } td.bad { color: var(--bad); font-weight: 700; }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 24px; }
  h2 { margin: 0 0 12px; font-size: 1.2rem; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; margin-bottom: 16px; }
  .pair h3 { grid-column: 1 / -1; margin: 8px 0 0; font-size: 1rem; color: var(--muted); }
  figure { margin: 0; } figcaption { font-size: .9rem; color: var(--muted); margin-bottom: 4px; }
  img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
  @media (max-width: 640px) { .pair { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <h1>مقارنة التخطيط: قبل وبعد</h1>
  <p class="lead">حارس التخطيط (e2e/golden/zz-layout-guard.spec.ts) على محل الاختبار في CI، بيانات وهمية فقط. ${b.fails} فشل قبل، ${a.fails} بعد.</p>
  <table>
    <thead><tr><th>الفحص</th><th>قبل</th><th>بعد</th></tr></thead>
    <tbody>
      ${checks.map((c) => `<tr><td>${esc(c)}</td><td>${b.by[c] || 0}</td><td class="${(a.by[c] || 0) < (b.by[c] || 0) ? 'good' : (a.by[c] || 0) > (b.by[c] || 0) ? 'bad' : ''}">${a.by[c] || 0}</td></tr>`).join('')}
      <tr><th>المجموع (فشل)</th><th>${b.fails}</th><th>${a.fails}</th></tr>
      <tr><td>تحذيرات</td><td>${b.warns}</td><td>${a.warns}</td></tr>
    </tbody>
  </table>
  ${rows}
</main>
</body>
</html>
`;
fs.writeFileSync(out, html);
console.log('wrote', out, `${b.fails} -> ${a.fails} fails`);
