// Prints a before/after table from two perf-out/<TAG>medians.json files.
// usage: node docs/perf/compare.cjs before- p12-
const fs = require('fs');
const [a, b] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(`perf-out/${a}medians.json`, 'utf8'));
const B = JSON.parse(fs.readFileSync(`perf-out/${b}medians.json`, 'utf8'));
const rows = [
  ['login-cold 4g', 'fcp', 'دخول 4G — أول رسم'],
  ['login-cold 4g', 'login_form', 'دخول 4G — ظهور النموذج'],
  ['login-cold 4g', 'tbt', 'دخول 4G — TBT'],
  ['app-open-cold 4g', 'fcp', 'فتح أول 4G — أول رسم'],
  ['app-open-cold 4g', 'app_shell', 'فتح أول 4G — ظهور التطبيق'],
  ['app-open-cold 4g', 'app_shell_no_skeleton', 'فتح أول 4G — اختفاء الهياكل'],
  ['app-open-cold 4g', 'tbt', 'فتح أول 4G — TBT'],
  ['app-open-cold 4g', 'jsKB', 'فتح أول 4G — JS المنزّل KB'],
  ['app-open-cold 4g DATA=big', 'app_shell_no_skeleton', 'فتح أول 4G بيانات كبيرة — اختفاء الهياكل'],
  ['app-open-cold wifi', 'app_shell', 'فتح أول wifi — ظهور التطبيق'],
  ['app-open-cold wifi', 'app_shell_no_skeleton', 'فتح أول wifi — اختفاء الهياكل'],
  ['app-open-cold wifi', 'supabaseRequests', 'فتح أول wifi — طلبات Supabase'],
  ['app-open-warm 4g', 'app_shell', 'عائد 4G — ظهور التطبيق'],
  ['app-open-warm 4g', 'app_shell_no_skeleton', 'عائد 4G — اختفاء الهياكل'],
  ['app-open-warm wifi REFOCUS=1', 'refocusSupabase', 'عودة للتبويب — طلبات Supabase'],
];
const get = (o, s, k) => { const r = o[s]; if (!r) return null; if (k === 'tbt') return r.tbtMs; return r.marks?.[k] ?? r[k] ?? null; };
console.log(`| المقياس | قبل (${a}) | بعد (${b}) | الفرق |`);
console.log('|---|---|---|---|');
for (const [s, k, label] of rows) {
  const x = get(A, s, k), y = get(B, s, k);
  const d = x != null && y != null ? (y - x > 0 ? '+' : '') + (y - x) : '';
  console.log(`| ${label} | ${x ?? '—'} | ${y ?? '—'} | ${d} |`);
}
