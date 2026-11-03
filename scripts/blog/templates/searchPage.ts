import { STYLE_BLOCK, FONTS_PRECONNECT, renderSiteHeader, renderSiteFooter, renderStickyMobileCta, BLOG_CLIENT_SCRIPT_TAG } from './shared';

// Static shell; the client-side filter (re-implementing filterSearchIndex's
// same lowercase-substring rule from scripts/blog/search.ts against the
// fetched search-index.json) lives in the external scripts/blog/assets/
// blog-client.js, loaded via BLOG_CLIENT_SCRIPT_TAG -- CSP's script-src
// 'self' has no 'unsafe-inline', so this page can't carry its own inline
// <script> the way the reference design and the first implementation did.
export function renderSearchPage(): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>البحث | مدونة سين</title>
<meta name="robots" content="noindex">
${FONTS_PRECONNECT}
<style>${STYLE_BLOCK}</style>
</head>
<body>
${renderSiteHeader()}
<main>
<section class="b-hero"><div class="wrap">
  <span class="eyebrow">مدونة سين</span>
  <h1>البحث</h1>
  <form class="search" role="search" action="https://seentech.io/blog/search"><label for="q" class="sr">ابحث في المدونة</label>
    <input id="q" name="q" type="search" placeholder="ابحث: مقاس، تأخير، رمضان، ورقة الطلب..."><button class="btn btn-ink" type="submit">بحث</button></form>
</div></section>
<section class="wrap" aria-labelledby="results-h">
  <div class="sec-h"><h2 id="results-h">نتائج البحث</h2></div>
  <div class="grid" id="results"></div>
  <p id="no-results" style="display:none">ما لقينا نتائج مطابقة.</p>
</section>
</main>
${renderSiteFooter()}
${renderStickyMobileCta()}
${BLOG_CLIENT_SCRIPT_TAG}
</body></html>`;
}
