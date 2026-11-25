/**
 * Before/after shots of five error messages (seen-friendly-errors-everywhere-task.md).
 *
 *   npx tsx scripts/responsive/error-shots.ts      (after `npm run build`)
 *
 * Draws the toast card (contexts/ToastStack.tsx) and the sign-in error box
 * (components/Login.tsx) with the built app's own CSS, once with the text
 * the old code showed and once with today's. The "before" texts are copied
 * from the code before this task; the database address is a placeholder.
 * Output: docs/responsive/friendly-errors/.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'docs/responsive/friendly-errors');
const ar = JSON.parse(readFileSync(path.join(ROOT, 'src/i18n/locales/ar.json'), 'utf8'));

const cssFile = readdirSync(path.join(ROOT, 'dist/assets')).find((f) => /^index-.*\.css$/.test(f));
if (!cssFile) throw new Error('run npm run build first');
const css = readFileSync(path.join(ROOT, 'dist/assets', cssFile), 'utf8').replace(/url\((['"]?)\/?assets\//g, `url($1file://${path.join(ROOT, 'dist/assets').replace(/\\/g, '/')}/`);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const u = (k: string) => `${ar.errors.user[k].title} ${ar.errors.user[k].action}`;

function toast(title: string, description?: string, code?: string, details?: string): string {
  return `<div role="alert" class="pointer-events-auto flex gap-4 w-[420px] p-4 rounded-2xl border shadow-xl bg-surface bg-danger/10 border-danger/20">
  <div class="mt-0.5"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-danger"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg></div>
  <div class="flex-1">
    <h4 class="text-sm font-black text-content">${esc(title)}</h4>
    ${description ? `<p class="mt-1 text-sm font-bold text-content-muted leading-relaxed">${esc(description)}</p>` : ''}
    ${code ? `<p class="mt-1 text-sm font-medium text-content-muted">${esc(ar.errors.user.code.replace('{{code}}', code))}</p>` : ''}
    ${details ? `<details open class="mt-2 text-sm text-content-muted"><summary class="cursor-pointer font-bold">${esc(ar.errors.user.technical_details)}</summary><p class="mt-1 break-all font-mono" dir="ltr">${esc(details)}</p></details>` : ''}
  </div>
</div>`;
}

function loginBox(text: string, code?: string): string {
  return `<div role="alert" class="w-[420px] bg-[var(--seen-danger-bg)] border border-danger/20 text-danger p-4 rounded-2xl flex items-start gap-3 text-sm font-bold">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
  <div class="min-w-0 flex-1 space-y-3"><p class="leading-relaxed break-words">${esc(text)}</p>
  ${code ? `<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <button class="inline-flex min-h-11 items-center gap-2 rounded-[8px] bg-danger px-4 text-white">${esc(ar.login.error_help.retry)}</button>
    <button class="min-h-11 underline underline-offset-4">${esc(ar.login.error_help.contact_support)}</button>
    <span class="ms-auto text-sm font-medium text-content-muted">${esc(ar.login.error_help.code.replace('{{code}}', code))}</span></div>` : ''}
  </div></div>`;
}

const SHOTS: Array<{ id: string; label: string; before: string; after: string }> = [
  {
    id: '1-login-blocked',
    label: 'الدخول من شبكة تحجب خدمة الدخول',
    before: loginBox('تعذر الاتصال بقاعدة البيانات. تأكد من أن الروابط تعمل وأنه لا يوجد أداة تحجب الاتصال (Adblocker). https://xxxxxxxxxxxxxxxxxxxx.supabase.co'),
    after: loginBox(ar.login.errors.friendly.blocked, 'NET-01'),
  },
  {
    id: '2-pos-server',
    label: 'خطأ من الخادم (500) أثناء إتمام بيع',
    before: toast('حدث خطأ في النظام. يرجى المحاولة مرة أخرى لاحقاً.', 'فشل إتمام العملية'),
    after: toast(ar.pos.checkout_failed, u('server'), 'SRV-01'),
  },
  {
    id: '3-duplicate-phone',
    label: 'حفظ عميل برقم جوال مكرر',
    before: toast('هذه البيانات مسجَّلة مسبقاً في النظام (قيمة مكرَّرة) — تحقق من عدم تكرار الإدخال.', 'CREATE error at customers'),
    after: toast(ar.errors.user.duplicate_phone.title, ar.errors.user.duplicate_phone.action, 'SAVE-01'),
  },
  {
    id: '4-printer-agent',
    label: 'برنامج الطباعة غير شغّال',
    before: toast('تعذّرت الطباعة', 'تعذر الوصول للوسيط المحلي. السبب أحد أمرين: إمّا أن نافذة الوسيط غير مفتوحة، أو أن المتصفح حجب الاتصال بـ 127.0.0.1 (سياسة Local Network Access في Chrome الحديث). الحل المضمون: استخدم «الاقتران مع وسيط سين» — يتصل الوسيط بالسيرفر خارجاً فلا يحتاج أي إذن من المتصفح، ويعمل على الأندرويد أيضاً.'),
    after: toast(ar.printing.agent.unreachable, undefined, 'PRN-02'),
  },
  {
    id: '5-employee-email',
    label: 'إضافة عضو فريق ببريد مستخدم (شاشة السوبر أدمن)',
    before: toast('A user with this email address has already been registered'),
    after: toast(ar.errors.user.duplicate_email.title, ar.errors.user.duplicate_email.action, 'SAVE-01', '409 · email_already_in_use'),
  },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 400 }, deviceScaleFactor: 2 });
for (const shot of SHOTS) {
  for (const side of ['before', 'after'] as const) {
    await page.setContent(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${css}</style></head>
<body class="bg-surface-muted" style="margin:0;padding:24px;font-family:Tajawal,system-ui,sans-serif"><div id="shot" style="display:inline-block">${shot[side]}</div></body></html>`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#shot').screenshot({ path: path.join(OUT, `${shot.id}-${side}.png`) });
  }
}
await browser.close();

const rows = SHOTS.map((s) => `<section><h2>${esc(s.label)}</h2><div class="pair">
<figure><figcaption>قبل</figcaption><img src="${s.id}-before.png" alt="قبل: ${esc(s.label)}"></figure>
<figure><figcaption>بعد</figcaption><img src="${s.id}-after.png" alt="بعد: ${esc(s.label)}"></figure></div></section>`).join('\n');
writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>سين — رسائل الأخطاء</title>
<style>body{font-family:Tajawal,system-ui,sans-serif;margin:0;padding:24px 16px;background:#F5F7FA;color:#14202B}h1{font-size:22px}h2{font-size:17px;margin:28px 0 10px}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}figure{margin:0;background:#fff;border:1px solid #DDE3EA;border-radius:8px;padding:12px}figcaption{font-weight:700;margin-bottom:8px}img{max-width:100%;height:auto}</style></head>
<body><h1>رسائل الأخطاء: قبل وبعد</h1><p>«قبل» من الكود قبل المهمة (رابط قاعدة البيانات مستبدل بنص بديل). «بعد» من الفرع fix/friendly-errors-everywhere.</p>
${rows}</body></html>\n`);
console.log('written', SHOTS.length * 2, 'shots to', path.relative(ROOT, OUT));
