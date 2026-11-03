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
  renderTrackingScript,
} from './shared';

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function formatArabicDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${day} ${ARABIC_MONTHS[month - 1]} ${year}`;
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
    <h3>${article.frontmatter.title}</h3>
    <p>${article.frontmatter.metaDescription}</p>
    <div class="meta"><span>${article.readTimeMinutes} دقايق قراءة</span><span class="dot"></span><span>${formatArabicDate(article.frontmatter.publishDate)}</span></div>
  </a>
</article>`;
}

function renderSection(section: ParsedArticle['sections'][number]): string {
  if (section.isModel) {
    return `<section id="${section.id}" aria-labelledby="${section.id}-h"><h2 id="${section.id}-h">${section.heading}</h2><div class="template" id="tpl"><div class="tbl">${section.bodyHtml}</div></div><button class="btn btn-ghost print" onclick="printTpl()">اطبع النموذج</button></section>`;
  }
  return `<section id="${section.id}" aria-labelledby="${section.id}-h"><h2 id="${section.id}-h">${section.heading}</h2>${section.bodyHtml}</section>`;
}

export function renderArticlePage(article: LoadedArticle, parsed: ParsedArticle, allArticles: LoadedArticle[]): string {
  const category = getCategory(article.frontmatter.cluster);
  const title = article.frontmatter.title;
  const pageTitle = `${title} | مدونة سين`;

  const articleJsonLd = buildArticleJsonLd(article);
  const faqJsonLd = buildFaqJsonLd(parsed.faq);
  const jsonLdScripts = [
    `<script type="application/ld+json">${JSON.stringify(articleJsonLd)}</script>`,
    faqJsonLd ? `<script type="application/ld+json">${JSON.stringify(faqJsonLd)}</script>` : '',
  ].join('\n');

  const tocItems = parsed.sections.map(s => `<li><a href="#${s.id}">${s.heading}</a></li>`).join('');
  const faqTocItem = parsed.faq.length > 0 ? '<li><a href="#faq">أسئلة شائعة</a></li>' : '';

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
    ? `<section id="faq" aria-labelledby="faq-h"><h2 id="faq-h">أسئلة شائعة</h2><div class="faq">${parsed.faq.map(item => `<details><summary>${item.question}</summary>${item.answerHtml}</details>`).join('')}</div></section>`
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

  const editedByHtml = parsed.editedBy ? `<span>تحرير: ${parsed.editedBy}</span><span class="dot"></span>` : '';

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<meta name="description" content="${article.frontmatter.metaDescription}">
<link rel="canonical" href="${article.canonicalUrl}">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${article.frontmatter.metaDescription}">
<meta property="og:image" content="https://seentech.io/blog/og/${article.slug}.png">
<meta property="og:locale" content="ar_SA">
${FONTS_PRECONNECT}
<style>${STYLE_BLOCK}</style>
${jsonLdScripts}
</head>
<body>
${renderSiteHeader()}
<main class="art">
<div class="wrap">
  <nav class="crumbs" aria-label="مسار الصفحة"><a href="https://seentech.io/blog/">المدونة</a><span>/</span><a href="https://seentech.io/blog/category/${article.frontmatter.cluster}">${category?.label ?? ''}</a></nav>
  <header class="art-h">
    <span class="cat-lg">${category?.icon ?? ''}${category?.label ?? ''}</span>
    <h1>${title}</h1>
    <div class="byline">${editedByHtml}<span>آخر تحديث ${formatArabicDate(article.frontmatter.publishDate)}</span><span class="dot"></span><span>${article.readTimeMinutes} دقايق قراءة</span></div>
    ${buildSummarizeLinks(article.canonicalUrl)}
  </header>
</div>
<div class="wrap art-grid">
  <aside class="toc" aria-label="في هذا المقال">
    <details open class="toc-box"><summary>في هذا المقال</summary><ol>${tocItems}${faqTocItem}</ol></details>
  </aside>
  <article class="prose">
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
${renderTrackingScript()}
<script>
(function(){var links=document.querySelectorAll('.toc a');var map={};links.forEach(function(a){map[a.getAttribute('href').slice(1)]=a});
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){links.forEach(function(l){l.classList.remove('cur')});var a=map[e.target.id];if(a)a.classList.add('cur')}})},{rootMargin:'-20% 0px -70% 0px'});
document.querySelectorAll('.prose section[id]').forEach(function(s){io.observe(s)})}
if(window.matchMedia('(max-width:1023px)').matches){var d=document.querySelector('.toc-box');if(d)d.removeAttribute('open')}})();
function printTpl(){document.body.classList.add('print-tpl');window.print();setTimeout(function(){document.body.classList.remove('print-tpl')},500)}
</script>
</body></html>`;
}
