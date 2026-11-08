import { getCategory } from '../categories';
import type { LoadedArticle } from '../frontmatter';
import type { ParsedArticle } from '../parseArticleSections';
import { buildArticleJsonLd, buildFaqJsonLd } from '../jsonLd';
import {
  STYLE_BLOCK,
  FONTS_PRECONNECT,
  renderSiteHeader,
  renderSiteFooter,
  renderStickyMobileCta,
  renderSideCta,
  BLOG_CLIENT_SCRIPT_TAG,
  renderAnalyticsLoaderTags,
  renderAnalyticsConfigScriptTag,
  renderRobotsMetaTag,
  getSiteUrl,
  escapeHtml,
} from './shared';

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

// Byline icons copied verbatim from seen-blog-reference/02_المقالة_من_الداخل.html
// lines 202-231 -- previously dropped when the byline was implemented.
const CALENDAR_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12" /><path d="M16 3l0 4" /><path d="M8 3l0 4" /><path d="M4 11l16 0" /><path d="M8 15h2v2h-2l0 -2" /></svg>';
const CLOCK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M12 7v5l3 3" /></svg>';

// The reference's `.tbl{overflow-x:auto;...}` wrapper is meant to give
// every table horizontal scroll on mobile, not just the print-model ones
// (which wrap explicitly in renderSection below) -- plain markdown tables
// inside a regular section rendered as bare <table> with no such wrapper.
function wrapTablesInHtml(html: string): string {
  return html.replace(/<table>/g, '<div class="tbl"><table>').replace(/<\/table>/g, '</table></div>');
}

// Formats in Asia/Riyadh local time, NOT UTC: the author now sends a real
// offset-aware ISO string, and a date near midnight (e.g. 00:30 Riyadh time)
// must show the Riyadh-local calendar day the author actually scheduled it
// for, not the UTC day it falls back to a few hours earlier. Saudi Arabia
// has no DST, so adding a fixed +3h to the UTC instant before reading date
// parts is always correct and needs no Intl dependency.
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

function formatArabicDate(isoDateTime: string): string {
  const d = new Date(new Date(isoDateTime).getTime() + RIYADH_OFFSET_MS);
  return `${d.getUTCDate()} ${ARABIC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function buildSummarizeLinks(canonicalUrl: string): string {
  const query = encodeURIComponent(`لخص لي هذي المقالة ببساطة لصاحب محل خياطة: ${canonicalUrl}`);
  return `<div class="summ"><span>لخصه مع:</span>
<a href="https://chatgpt.com/?q=${query}" target="_blank" rel="noopener" data-track="summ_chatgpt">ChatGPT</a>
<a href="https://claude.ai/new?q=${query}" target="_blank" rel="noopener" data-track="summ_claude">Claude</a>
<a href="https://www.perplexity.ai/search?q=${query}" target="_blank" rel="noopener" data-track="summ_perplexity">Perplexity</a></div>`;
}

function renderRelatedCard(article: LoadedArticle): string {
  const category = getCategory(article.frontmatter.cluster);
  const icon = category?.icon ?? '';
  const label = category?.label ?? '';
  return `<article class="card" data-pillar="${article.frontmatter.cluster}">
  <a href="${article.canonicalUrl}" class="card-link">
    <div class="card-top"><span class="pill-ic">${icon}</span><span class="cat">${label}</span></div>
    <h3>${escapeHtml(article.frontmatter.title)}</h3>
    <p>${escapeHtml(article.frontmatter.metaDescription)}</p>
    <div class="meta"><span>${article.readTimeMinutes} دقايق قراءة</span><span class="dot"></span><span>${formatArabicDate(article.frontmatter.publishDate)}</span></div>
  </a>
</article>`;
}

function renderSection(section: ParsedArticle['sections'][number]): string {
  if (section.isModel) {
    // The print button lives INSIDE #tpl (per the reference) -- STYLE_BLOCK's
    // print rule `body.print-tpl .print{display:none}` only has any effect
    // when `.print` is a descendant of `#tpl` (print mode makes everything
    // OUTSIDE #tpl invisible already); outside it, that CSS was dead code.
    return `<section id="${section.id}" aria-labelledby="${section.id}-h"><h2 id="${section.id}-h">${escapeHtml(section.heading)}</h2><div class="template" id="tpl"><div class="tbl">${section.bodyHtml}</div><button class="btn btn-ghost print" data-print-tpl>اطبع النموذج</button></div></section>`;
  }
  return `<section id="${section.id}" aria-labelledby="${section.id}-h"><h2 id="${section.id}-h">${escapeHtml(section.heading)}</h2>${wrapTablesInHtml(section.bodyHtml)}</section>`;
}

// JSON.stringify never escapes `<`, so a literal `</script>` inside any
// string value (a title, an FAQ answer) would close the script element
// early and break out of the JSON-LD payload into the surrounding HTML.
function jsonLdScriptTag(data: object): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

export function renderArticlePage(article: LoadedArticle, parsed: ParsedArticle, allArticles: LoadedArticle[]): string {
  const category = getCategory(article.frontmatter.cluster);
  const title = escapeHtml(article.frontmatter.title);
  const metaDescription = escapeHtml(article.frontmatter.metaDescription);
  const pageTitle = `${title} | مدونة سين`;

  const articleJsonLd = buildArticleJsonLd(article);
  const faqJsonLd = buildFaqJsonLd(parsed.faq);
  const jsonLdScripts = [
    jsonLdScriptTag(articleJsonLd),
    faqJsonLd ? jsonLdScriptTag(faqJsonLd) : '',
  ].join('\n');

  const tocItems = parsed.sections.map(s => `<li><a href="#${s.id}">${escapeHtml(s.heading)}</a></li>`).join('');
  const faqTocItem = parsed.faq.length > 0 ? '<li><a href="#faq">أسئلة شائعة</a></li>' : '';

  const leadingBox = parsed.leadingHtml ? parsed.leadingHtml : '';

  const summaryBox = parsed.summaryHtml
    ? `<div class="quick"><span class="q-label">الجواب المختصر</span>${parsed.summaryHtml}</div>`
    : '';

  const sectionsHtml = parsed.sections.map(renderSection).join('\n');

  // The "نوريك إياه في محلك" button is fixed verbatim -- never driven by
  // blogConfig, per the task's explicit exception.
  const whereSeenFitsBox = parsed.whereSeenFitsHtml
    ? `<aside class="inline-cta" aria-label="وين تدخل منصة سين"><div><h2>وين تدخل منصة سين؟</h2>${parsed.whereSeenFitsHtml}</div><a class="btn btn-cta" href="https://seentech.io/#book" data-track="cta_inline">نوريك إياه في محلك</a></aside>`
    : '';

  const aboutBox = parsed.aboutSeenHtml
    ? `<aside class="about"><b>عن منصة سين</b>${parsed.aboutSeenHtml}</aside>`
    : '';

  const faqSection = parsed.faq.length > 0
    ? `<section id="faq" aria-labelledby="faq-h"><h2 id="faq-h">أسئلة شائعة</h2><div class="faq">${parsed.faq.map(item => `<details><summary>${escapeHtml(item.question)}</summary>${item.answerHtml}</details>`).join('')}</div></section>`
    : '';

  const relatedArticles: LoadedArticle[] = [];
  for (const slug of article.frontmatter.related) {
    const found = allArticles.find(a => a.slug === slug);
    if (found) {
      relatedArticles.push(found);
    } else {
      console.warn(`[blog] ${article.slug}: related slug "${slug}" does not resolve to any loaded article, skipping`);
    }
  }
  const relatedSection = relatedArticles.length > 0
    ? `<section class="wrap related" aria-labelledby="rel-h"><h2 id="rel-h">اقرأ بعد</h2><div class="grid">${relatedArticles.map(renderRelatedCard).join('')}</div></section>`
    : '';

  const editedByHtml = parsed.editedBy ? `<span>تحرير: ${escapeHtml(parsed.editedBy)}</span><span class="dot"></span>` : '';

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<meta name="description" content="${metaDescription}">
<link rel="canonical" href="${article.canonicalUrl}">
<meta property="og:type" content="article">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${metaDescription}">
<meta property="og:image" content="https://seentech.io/blog/og/${article.slug}.png">
<meta property="og:locale" content="ar_SA">
<meta property="article:published_time" content="${article.frontmatter.publishDate}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${metaDescription}">
<meta name="twitter:image" content="https://seentech.io/blog/og/${article.slug}.png">
${renderRobotsMetaTag()}
${FONTS_PRECONNECT}
<style>${STYLE_BLOCK}</style>
${renderAnalyticsLoaderTags()}
${jsonLdScripts}
</head>
<body>
${renderSiteHeader()}
<main class="art">
<div class="wrap">
  <nav class="crumbs" aria-label="مسار الصفحة"><a href="${getSiteUrl()}/blog/">المدونة</a><span>/</span><a href="${getSiteUrl()}/blog/category/${article.frontmatter.cluster}">${category?.label ?? ''}</a></nav>
  <header class="art-h">
    <span class="cat-lg">${category?.icon ?? ''}${category?.label ?? ''}</span>
    <h1>${title}</h1>
    <div class="byline">${editedByHtml}<span>${CALENDAR_ICON}آخر تحديث ${formatArabicDate(article.frontmatter.publishDate)}</span><span class="dot"></span><span>${CLOCK_ICON}${article.readTimeMinutes} دقايق قراءة</span></div>
    ${buildSummarizeLinks(article.canonicalUrl)}
  </header>
</div>
<div class="wrap art-grid">
  <aside class="toc" aria-label="في هذا المقال">
    <details open class="toc-box"><summary>في هذا المقال</summary><ol>${tocItems}${faqTocItem}</ol></details>
  </aside>
  <article class="prose">
    ${leadingBox}
    ${summaryBox}
    ${sectionsHtml}
    ${whereSeenFitsBox}
    ${aboutBox}
    ${faqSection}
  </article>
  ${renderSideCta()}
</div>
${relatedSection}
</main>
${renderSiteFooter()}
${renderStickyMobileCta()}
${BLOG_CLIENT_SCRIPT_TAG}
${renderAnalyticsConfigScriptTag()}
</body></html>`;
}
