import { blogConfig } from '../../../content/blog.config';

// Content is trusted (git-committed, not user-submitted at runtime), so
// this is a correctness fix, not an XSS one: an ASCII quote or `&` in a
// frontmatter title/description otherwise corrupts the HTML attribute or
// text node it's interpolated into. Safe for both text nodes and
// double-quoted attributes.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Logo images copied verbatim as the inlined base64 data URIs the reference
// design ships (seen-blog-reference/01_المدونة_من_الخارج.html lines 190 and
// 634) -- header and footer use two DIFFERENT images at different aspect
// ratios (79x34 wordmark vs 51x64 mark), so neither can be swapped for the
// project's single public/Logo.svg without distorting one of them.
const HEADER_LOGO_DATA_URI = 'data:image/png;base64,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';

const FOOTER_LOGO_DATA_URI = "data:image/png;base64,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";

// Verbatim from both reference files (identical head boilerplate,
// seen-blog-reference/01_المدونة_من_الخارج.html lines 12-14 /
// 02_المقالة_من_الداخل.html lines 12-14) -- loads the two fonts STYLE_BLOCK
// references (--h: Tajawal, --b: IBM Plex Sans Arabic).
export const FONTS_PRECONNECT = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Tajawal:wght@700;800&display=swap" rel="stylesheet">`;

// Verbatim from seen-blog-reference/01_المدونة_من_الخارج.html lines 16-184
// (identical to 02_المقالة_من_الداخل.html lines 16-184 -- confirmed by diff,
// both reference files ship the same combined stylesheet for both page
// types, so no union/merge was needed).
export const STYLE_BLOCK = `:root{
  --ink:#0E2A42;--ink-2:#28445c;--paper:#F6F7F8;--white:#fff;--line:#DDE3E8;--gray:#5B6B79;
  --sky:#33C2F1;            /* على الحبر فقط */
  --cta:#0F6E96;--cta-hover:#0B5A7B;  /* للأزرار فقط */
  --tint:#EAF3F8;           /* خلفية الجواب المختصر */
  --r:14px;--r-sm:10px;--shadow:0 10px 30px rgba(14,42,66,.08);
  --h:'Tajawal',system-ui,sans-serif;--b:'IBM Plex Sans Arabic',system-ui,sans-serif;--ease:cubic-bezier(.16,1,.3,1)
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--b);color:var(--ink);background:var(--paper);font-size:18px;line-height:1.75;-webkit-font-smoothing:antialiased}
a{color:inherit}
h1,h2,h3{font-family:var(--h);font-weight:800;line-height:1.3}
img{display:block;max-width:100%}
.wrap{width:min(1180px,100% - 36px);margin-inline:auto}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
:focus-visible{outline:3px solid var(--sky);outline-offset:3px;border-radius:6px}
.eyebrow{font-size:15px;font-weight:600;color:var(--ink-2)}
.dot{width:4px;height:4px;border-radius:50%;background:#B8C3CC;display:inline-block}
svg{flex:none}

/* الأزرار */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 22px;border-radius:999px;font-family:var(--b);font-weight:700;font-size:17px;text-decoration:none;border:0;cursor:pointer;transition:background .2s,transform .2s var(--ease)}
.btn-cta{background:var(--cta);color:#fff}
.btn-cta:hover{background:var(--cta-hover);transform:translateY(-1px)}
.btn-ink{background:var(--ink);color:#fff}
.btn-ghost{background:#fff;color:var(--ink);border:1.5px solid var(--line)}
.btn-ghost:hover{border-color:var(--ink)}
.btn-ghost-l{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.4)}
.btn-sm{min-height:42px;font-size:15px;padding:0 16px}

/* الهيدر */
header.top{position:sticky;top:0;z-index:20;background:rgba(246,247,248,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:24px;height:64px}
.logo img{height:32px;width:auto}
.nav{display:flex;gap:18px;margin-inline-start:8px;flex:1;font-size:16px}
.nav a{text-decoration:none;color:var(--gray)}
.nav a[aria-current]{color:var(--ink);font-weight:700}
@media(max-width:700px){.nav{display:none}.top .btn{margin-inline-start:auto}}

/* المسطرة */
.ruler{height:20px;margin-top:36px;background:
 repeating-linear-gradient(to left,var(--ink) 0 1.5px,transparent 1.5px 100px) bottom/100% 20px no-repeat,
 repeating-linear-gradient(to left,var(--ink) 0 1px,transparent 1px 50px) bottom/100% 13px no-repeat,
 repeating-linear-gradient(to left,var(--ink) 0 1px,transparent 1px 10px) bottom/100% 7px no-repeat;opacity:.16}

/* ===== صفحة المدونة ===== */
.b-hero{padding:52px 0 0}
.b-hero h1{font-size:clamp(32px,5.2vw,52px);margin:8px 0 12px}
.b-hero .lead{font-size:clamp(17px,2vw,20px);color:var(--ink-2);max-width:36em}
.search{display:flex;gap:8px;margin-top:24px;max-width:620px;background:#fff;border:1.5px solid var(--line);border-radius:999px;padding:6px}
.search input{flex:1;border:0;font:inherit;font-size:17px;padding:0 14px;background:transparent;min-width:0}
.search input:focus{outline:none}
.chips{display:flex;gap:8px;overflow-x:auto;padding:22px 0 6px;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;border:1.5px solid var(--line);background:#fff;border-radius:999px;padding:8px 14px;font:inherit;font-size:15px;color:var(--ink);cursor:pointer;text-decoration:none}
.chip.on{background:var(--ink);border-color:var(--ink);color:#fff}
.feat-row{display:grid;gap:18px;margin-top:22px}
@media(min-width:900px){.feat-row{grid-template-columns:1.5fr 1fr}}
.card{background:#fff;border:1px solid var(--line);border-radius:var(--r);transition:border-color .2s,box-shadow .2s}
.card:hover{border-color:#B9C6D0;box-shadow:var(--shadow)}
.card-link{display:flex;flex-direction:column;gap:10px;height:100%;padding:22px;text-decoration:none}
.card h3{font-size:21px}
.card p{color:var(--gray);font-size:16px;line-height:1.7;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card-top{display:flex;align-items:center;gap:8px}
.pill-ic{display:inline-grid;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--paper);color:var(--ink)}
.cat{font-size:14px;font-weight:600;color:var(--ink-2)}
.meta{display:flex;align-items:center;gap:8px;margin-top:auto;font-size:14px;color:var(--gray)}
.card-big .card-link{padding:30px;justify-content:flex-end;min-height:300px;background:
 linear-gradient(transparent 60%,#fff 60%),repeating-linear-gradient(to left,#E6ECF0 0 1px,transparent 1px 22px);border-radius:var(--r)}
.card-big h3{font-size:clamp(24px,3vw,32px)}
.card-big .pill-ic{width:52px;height:52px;background:var(--ink);color:#fff}
.start{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:22px}
.start h2{font-size:22px;margin-bottom:10px}
.start ol{list-style:none}
.start li a{display:flex;gap:14px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--line);text-decoration:none}
.start li:first-child a{border-top:0}
.start .num{font-family:var(--h);font-size:22px;color:var(--gray);min-width:22px}
.start b{display:block;font-size:17px;line-height:1.5}
.start small{color:var(--gray);font-size:14px}
.band{margin:44px 0}
.dark{background:var(--ink);color:#fff}
.band-in{display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between;padding:34px 0}
.big-n{font-family:var(--h);font-size:clamp(44px,6vw,64px);color:var(--sky);line-height:1}
.band p{margin-top:8px;font-size:19px;max-width:30em}
.band .src{font-size:13px;color:#B9C7D3}
.sec-h h2{font-size:clamp(26px,3.4vw,34px);margin:6px 0 18px}
.grid{display:grid;gap:16px}
@media(min-width:700px){.grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1024px){.grid{grid-template-columns:repeat(3,1fr)}}
.more{text-align:center;margin:26px 0 10px}
.cta-panel{display:flex;flex-wrap:wrap;gap:20px;justify-content:space-between;align-items:center;background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:28px;margin:40px 0 56px}
.cta-panel h2{font-size:clamp(22px,3vw,28px);margin-bottom:6px}
.cta-panel p{color:var(--gray)}
.cta-actions{display:flex;gap:10px;flex-wrap:wrap}

/* ===== صفحة المقالة ===== */
.crumbs{display:flex;gap:8px;font-size:14px;color:var(--gray);padding-top:24px}
.crumbs a{text-decoration:none}
.art-h{max-width:820px;padding:18px 0 8px}
.cat-lg{display:inline-flex;align-items:center;gap:8px;font-size:15px;font-weight:600;background:#fff;border:1px solid var(--line);border-radius:999px;padding:4px 12px 4px 14px}
.art-h h1{font-size:clamp(30px,4.6vw,46px);margin:14px 0}
.byline{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:15px;color:var(--gray)}
.byline span{display:inline-flex;align-items:center;gap:6px}
.summ{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:16px;font-size:14px;color:var(--gray)}
.summ a{border:1px solid var(--line);background:#fff;border-radius:999px;padding:4px 12px;text-decoration:none;color:var(--ink);font-weight:600}
.summ a:hover{border-color:var(--ink)}
.art-grid{display:grid;gap:28px;padding:24px 0 10px}
@media(min-width:1024px){.art-grid{grid-template-columns:230px minmax(0,1fr) 260px;align-items:start}}
.toc{position:relative}
@media(min-width:1024px){.toc,.side-cta{position:sticky;top:88px}}
.toc-box{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:6px 16px}
.toc-box summary{cursor:pointer;font-weight:700;padding:10px 0;list-style:none}
.toc-box summary::-webkit-details-marker{display:none}
.toc-box ol{list-style:none;padding-bottom:10px}
.toc-box li a{display:block;padding:6px 10px;border-inline-start:2px solid var(--line);font-size:15px;color:var(--gray);text-decoration:none;line-height:1.5}
.toc-box li a.cur{border-color:var(--ink);color:var(--ink);font-weight:600}
.prose{min-width:0;max-width:720px}
.prose section{scroll-margin-top:90px}
.prose h2{font-size:clamp(23px,3vw,29px);margin:38px 0 12px}
.prose p{margin:0 0 16px}
.prose ul{margin:0 0 16px;padding-inline-start:22px}
.prose li{margin-bottom:8px}
.prose strong{font-weight:700}
.quick{background:var(--tint);border-radius:var(--r);padding:20px 22px;border-inline-start:4px solid var(--ink)}
.q-label{display:block;font-family:var(--h);font-size:15px;color:var(--ink-2);margin-bottom:4px}
.quick p{margin:0;font-size:19px}
.tbl{overflow-x:auto;margin:6px 0 18px;border:1px solid var(--line);border-radius:var(--r-sm);background:#fff}
table{width:100%;border-collapse:collapse;font-size:16px;min-width:480px}
th{background:var(--paper);text-align:start;font-weight:700;padding:12px 14px;border-bottom:1px solid var(--line)}
td{padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
.template{background:#fff;border:1.5px dashed #B9C6D0;border-radius:var(--r);padding:16px}
.template .tbl{border:0}
.template td{height:44px}
.print{margin-top:10px}
.inline-cta{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;background:var(--ink);color:#fff;border-radius:var(--r);padding:24px;margin:34px 0}
.inline-cta h2{font-size:22px;margin:0 0 6px;color:#fff}
.inline-cta p{margin:0;color:#D7E1EA;max-width:32em}
.about{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:18px 20px;margin:10px 0 6px;font-size:16px}
.about b{font-family:var(--h);display:block;margin-bottom:4px}
.about p{margin:0;color:var(--ink-2)}
.faq details{background:#fff;border:1px solid var(--line);border-radius:var(--r-sm);margin-bottom:10px}
.faq summary{cursor:pointer;list-style:none;padding:16px 18px;font-weight:700;display:flex;justify-content:space-between;gap:12px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";color:var(--gray);font-size:22px;line-height:1;transition:transform .2s var(--ease)}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq details p{padding:0 18px 16px;margin:0;color:var(--ink-2)}
.side-card{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:22px;display:flex;flex-direction:column;gap:10px}
.side-ic{display:inline-grid;place-items:center;width:52px;height:52px;border-radius:14px;background:var(--paper)}
.side-card h3{font-size:20px}
.side-card p{color:var(--gray);font-size:16px}
.side-wa{display:inline-flex;gap:6px;align-items:center;justify-content:center;font-size:15px;color:var(--ink-2)}
@media(max-width:1023px){.side-cta{display:none}}
.related{padding:20px 0 50px}
.related h2{font-size:clamp(24px,3vw,30px);margin-bottom:16px}

/* التذييل */
footer{background:var(--ink);color:#C9D5DF;padding:40px 0 110px;font-size:15px}
footer .wrap{display:grid;gap:18px}
@media(min-width:800px){footer .wrap{grid-template-columns:auto 1fr auto;align-items:center}}
footer img{height:64px;width:auto}
footer a{color:#fff}

/* زر الجوال الثابت */
.sticky-cta{position:fixed;inset-inline:0;bottom:0;z-index:30;display:flex;gap:10px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:rgba(255,255,255,.96);border-top:1px solid var(--line)}
.sticky-cta .btn-cta{flex:1}
@media(min-width:1024px){.sticky-cta{display:none}footer{padding-bottom:40px}}

@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
@media print{body.print-tpl *{visibility:hidden}body.print-tpl #tpl,body.print-tpl #tpl *{visibility:visible}body.print-tpl #tpl{position:absolute;inset:0}body.print-tpl .print{display:none}}`;

// Verbatim from seen-blog-reference/01_المدونة_من_الخارج.html lines 189-193
// (identical header markup in 02_المقالة_من_الداخل.html lines 190-194,
// aria-current="page" sits on "المدونة" unconditionally in both).
export function renderSiteHeader(): string {
  return `<header class="top"><div class="wrap">
  <a class="logo" href="https://seentech.io/" aria-label="سين"><img src="${HEADER_LOGO_DATA_URI}" alt="سين" width="79" height="34"></a>
  <nav class="nav" aria-label="الرئيسية"><a href="https://seentech.io/">الرئيسية</a><a href="https://seentech.io/blog/" aria-current="page">المدونة</a></nav>
  <a class="btn btn-cta btn-sm" href="${blogConfig.ctaUrl}" data-track="cta_header">${blogConfig.ctaLabel}</a>
</div></header>`;
}

// Verbatim from seen-blog-reference/01_المدونة_من_الخارج.html lines 633-637.
export function renderSiteFooter(): string {
  return `<footer><div class="wrap">
  <img src="${FOOTER_LOGO_DATA_URI}" alt="سين" width="51" height="64">
  <div><p>مدونة سين: لصاحب محل التفصيل اللي يبي شغله أهدى.</p><p>سين تكنولوجي، جدة. <a href="mailto:info@seentech.io">info@seentech.io</a> | @getseentech</p></div>
  <p>© 2026 سين</p>
</div></footer>`;
}

// Verbatim from seen-blog-reference/01_المدونة_من_الخارج.html lines 638-652,
// CTA anchor text/href replaced with blogConfig, WhatsApp number replaced
// with blogConfig.whatsappNumber.
export function renderStickyMobileCta(): string {
  // blogConfig.whatsappNumber is an intentionally-empty "fill in later"
  // value (content/blog.config.ts) -- rendering the WhatsApp button
  // against it unconditionally produced a dead `https://wa.me/` link with
  // no number on every page until someone supplies it.
  const whatsappLink = blogConfig.whatsappNumber
    ? `<a class="btn btn-ghost" href="https://wa.me/${blogConfig.whatsappNumber}" aria-label="واتساب" data-track="whatsapp_sticky"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 21l1.65 -3.8a9 9 0 1 1 3.4 2.9l-5.05 .9" /><path d="M9 10a.5 .5 0 0 0 1 0v-1a.5 .5 0 0 0 -1 0v1a5 5 0 0 0 5 5h1a.5 .5 0 0 0 0 -1h-1a.5 .5 0 0 0 0 1" /></svg></a>`
    : '';
  return `<div class="sticky-cta"><a class="btn btn-cta" href="${blogConfig.ctaUrl}" data-track="cta_sticky">${blogConfig.ctaLabel}</a>${whatsappLink}</div>`;
}

// The click-tracking, chip-filter, TOC-scrollspy/print and search-page
// scripts (previously four separate inline <script> blocks) are now one
// external, same-origin file -- vercel.json's CSP ships
// `script-src 'self'` with no `unsafe-inline`, which silently blocked
// every inline <script> on every blog page in production. Every template
// includes this single tag once; scripts/build-blog.ts copies the source
// file to dist/blog/blog.js verbatim.
export const BLOG_CLIENT_SCRIPT_TAG = '<script src="/blog/blog.js" defer></script>';

// Loader tags for GA4/Snapchat/Meta -- external <script src>/<noscript>
// elements only, so nothing here needs CSP's script-src to allow inline
// script. The actual init calls (which DO need the real IDs) are baked at
// build time into dist/blog/blog-config.js by scripts/blog/analytics.ts,
// never inlined on the page. Returns '' per-provider when its id is unset.
export function renderAnalyticsLoaderTags(): string {
  const tags: string[] = [];
  if (blogConfig.ga4MeasurementId) {
    tags.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${blogConfig.ga4MeasurementId}"></script>`);
  }
  if (blogConfig.metaPixelId) {
    tags.push(`<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${blogConfig.metaPixelId}&ev=PageView&noscript=1" alt=""></noscript>`);
  }
  return tags.join('\n');
}

export function renderAnalyticsConfigScriptTag(): string {
  const anyConfigured = !!(blogConfig.ga4MeasurementId || blogConfig.snapchatPixelId || blogConfig.metaPixelId);
  return anyConfigured ? '<script src="/blog/blog-config.js" defer></script>' : '';
}

// Verbatim from seen-blog-reference/02_المقالة_من_الداخل.html lines 371-393,
// aria-label and CTA anchor text/href replaced with blogConfig. Only used by
// the article template -- hidden on mobile by its own `.side-cta` CSS
// (@media(max-width:1023px)) already in STYLE_BLOCK.
export function renderSideCta(): string {
  const whatsappLink = blogConfig.whatsappNumber
    ? `<a class="side-wa" href="https://wa.me/${blogConfig.whatsappNumber}" data-track="whatsapp_side"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 21l1.65 -3.8a9 9 0 1 1 3.4 2.9l-5.05 .9" /><path d="M9 10a.5 .5 0 0 0 1 0v-1a.5 .5 0 0 0 -1 0v1a5 5 0 0 0 5 5h1a.5 .5 0 0 0 0 -1h-1a.5 .5 0 0 0 0 1" /></svg> أو راسلنا واتساب</a>`
    : '';
  return `<aside class="side-cta" aria-label="${blogConfig.ctaLabel}">
    <div class="side-card">
      <span class="side-ic"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2"/><path d="M12 3v4"/><path d="M9 14h6"/><path d="M9 17h3"/><path d="M12 10.5h.01"/></svg></span>
      <h3>كل طلب بمرحلته وموعده</h3>
      <p>نجيك ربع ساعة ونوريك طلباتك أنت في سين.</p>
      <a class="btn btn-cta" href="${blogConfig.ctaUrl}" data-track="cta_side">${blogConfig.ctaLabel}</a>
      ${whatsappLink}
    </div>
  </aside>`;
}
