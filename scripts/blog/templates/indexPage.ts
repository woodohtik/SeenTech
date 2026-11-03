import { blogConfig } from '../../../content/blog.config';
import { CATEGORIES, getCategory, type CategoryDef } from '../categories';
import type { LoadedArticle } from '../frontmatter';
import {
  STYLE_BLOCK,
  FONTS_PRECONNECT,
  renderSiteHeader,
  renderSiteFooter,
  renderStickyMobileCta,
  BLOG_CLIENT_SCRIPT_TAG,
  renderAnalyticsLoaderTags,
  renderAnalyticsConfigScriptTag,
  escapeHtml,
} from './shared';

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function formatArabicDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${day} ${ARABIC_MONTHS[month - 1]} ${year}`;
}

function sortByDateDesc(articles: LoadedArticle[]): LoadedArticle[] {
  return [...articles].sort((a, b) => b.frontmatter.publishDate.localeCompare(a.frontmatter.publishDate));
}

function renderArticleCard(article: LoadedArticle, big = false): string {
  const category = getCategory(article.frontmatter.cluster);
  const icon = category?.icon ?? '';
  const label = category?.label ?? '';
  return `<article class="card${big ? ' card-big' : ''}" data-pillar="${article.frontmatter.cluster}">
  <a href="${article.canonicalUrl}" class="card-link">
    <div class="card-top"><span class="pill-ic">${icon}</span><span class="cat">${label}</span></div>
    <h3>${escapeHtml(article.frontmatter.title)}</h3>
    <p>${escapeHtml(article.frontmatter.metaDescription)}</p>
    <div class="meta"><span>${article.readTimeMinutes} دقايق قراءة</span><span class="dot"></span><span>${formatArabicDate(article.frontmatter.publishDate)}</span></div>
  </a>
</article>`;
}

// activeSlug is 'all' on the index page and the category's own slug on a
// category page -- a category page previously always rendered "الكل" as
// current, which both marked the wrong chip active and, combined with the
// chip-filter script running there too, filtered against cards that don't
// exist on that page (every category page only ever has its own articles
// in the DOM).
function renderChipsNav(activeSlug: string): string {
  const chips = CATEGORIES.map(c => {
    const isActive = c.slug === activeSlug;
    return `<a class="chip${isActive ? ' on' : ''}" href="https://seentech.io/blog/category/${c.slug}" data-f="${c.slug}"${isActive ? ' aria-current="page"' : ''}>${c.icon}<span>${c.label}</span></a>`;
  }).join('');
  const allIsActive = activeSlug === 'all';
  return `<nav class="chips wrap" aria-label="المحاور"><a class="chip${allIsActive ? ' on' : ''}" href="https://seentech.io/blog/" data-f="all"${allIsActive ? ' aria-current="page"' : ''}>الكل</a>${chips}</nav>`;
}

function renderCtaPanel(): string {
  const whatsappLink = blogConfig.whatsappNumber
    ? `<a class="btn btn-ghost" href="https://wa.me/${blogConfig.whatsappNumber}" data-track="whatsapp_blog_index"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 21l1.65 -3.8a9 9 0 1 1 3.4 2.9l-5.05 .9" /><path d="M9 10a.5 .5 0 0 0 1 0v-1a.5 .5 0 0 0 -1 0v1a5 5 0 0 0 5 5h1a.5 .5 0 0 0 0 -1h-1a.5 .5 0 0 0 0 1" /></svg> واتساب</a>`
    : '';
  return `<section class="wrap"><div class="cta-panel">
  <div><h2>تبي تشوف هالكلام على طلبات محلك؟</h2><p>نجيك ربع ساعة في الرياض أو جدة، ونوريك سين على طلباتك أنت.</p></div>
  <div class="cta-actions"><a class="btn btn-cta" href="${blogConfig.ctaUrl}" data-track="cta_blog_index">${blogConfig.ctaLabel}</a>${whatsappLink}</div>
</div></section>`;
}

function renderHead(title: string, description: string, canonical: string): string {
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:locale" content="ar_SA">
${FONTS_PRECONNECT}
<style>${STYLE_BLOCK}</style>
${renderAnalyticsLoaderTags()}
</head>`;
}

// pageType controls whether the chip-filter in the external blog.js
// attaches: it only makes sense on the index page, where every article's
// card is already present in the DOM to filter -- a category page's DOM
// only ever holds that one category's cards, so running the same filter
// there was a no-op at best and silently hid real cards at worst.
function renderPageShell(head: string, mainContent: string, pageType: 'index' | 'category'): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
${head}
<body data-blog-page="${pageType}">
${renderSiteHeader()}
<main>
${mainContent}
${renderCtaPanel()}
</main>
${renderSiteFooter()}
${renderStickyMobileCta()}
${BLOG_CLIENT_SCRIPT_TAG}
${renderAnalyticsConfigScriptTag()}
</body></html>`;
}

export function renderIndexPage(allArticles: LoadedArticle[]): string {
  const sorted = sortByDateDesc(allArticles);
  const featured = sorted[0];
  const startHere = blogConfig.startHereSlugs
    .map(slug => allArticles.find(a => a.slug === slug))
    .filter((a): a is LoadedArticle => !!a);

  const featuredRow = featured
    ? `<section class="wrap feat-row" aria-label="مختارات">
  ${renderArticleCard(featured, true)}
  ${startHere.length > 0 ? `<aside class="start"><h2>ابدأ من هنا</h2><ol>${startHere.map((a, i) => `<li><a href="${a.canonicalUrl}"><span class="num">${i + 1}</span><span><b>${a.frontmatter.title}</b><small>${getCategory(a.frontmatter.cluster)?.label ?? ''}</small></span></a></li>`).join('')}</ol></aside>` : ''}
</section>`
    : '';

  const interviewBand = blogConfig.interviewStat.stat
    ? `<section class="band dark"><div class="wrap band-in">
  <div><div class="big-n">${blogConfig.interviewStat.stat}</div><p>${blogConfig.interviewStat.description}</p><p class="src">${blogConfig.interviewStat.source}</p></div>
</div></section>`
    : '';

  const grid = sorted.map(a => renderArticleCard(a)).join('');

  const mainContent = `<section class="b-hero"><div class="wrap">
  <span class="eyebrow">مدونة سين</span>
  <h1>نكتب لصاحب محل التفصيل<br>اللي يبي شغله أهدى.</h1>
  <p class="lead">الطلبات والمقاسات والموسم، بأمثلة من محلات حقيقية ونماذج تطبعها وتستخدمها بكرة.</p>
  <form class="search" role="search" action="https://seentech.io/blog/search"><label for="q" class="sr">ابحث في المدونة</label>
    <input id="q" name="q" type="search" placeholder="ابحث: مقاس، تأخير، رمضان، ورقة الطلب..."><button class="btn btn-ink" type="submit">بحث</button></form>
</div><div class="wrap"><div class="ruler" aria-hidden="true"></div></div></section>
${renderChipsNav('all')}
${featuredRow}
${interviewBand}
<section class="wrap" aria-labelledby="latest-h">
  <div class="sec-h"><h2 id="latest-h">آخر المقالات</h2></div>
  <div class="grid" id="grid">${grid}</div>
</section>`;

  return renderPageShell(
    renderHead('مدونة سين | دليل صاحب محل التفصيل', 'مقالات عملية لصاحب محل التفصيل: الطلبات والمقاسات والموسم واختيار البرنامج، مبنية على مقابلات مع محلات في الرياض.', 'https://seentech.io/blog/'),
    mainContent,
    'index'
  );
}

export function renderCategoryPage(category: CategoryDef, articlesInCategory: LoadedArticle[]): string {
  const sorted = sortByDateDesc(articlesInCategory);
  const grid = sorted.length > 0
    ? `<div class="grid" id="grid">${sorted.map(a => renderArticleCard(a)).join('')}</div>`
    : `<p>قريباً — لسه ما نشرنا مقالات في «${category.label}».</p>`;

  const mainContent = `<section class="b-hero"><div class="wrap">
  <span class="eyebrow">مدونة سين</span>
  <h1>${category.label}</h1>
</div></section>
${renderChipsNav(category.slug)}
<section class="wrap" aria-labelledby="latest-h">
  <div class="sec-h"><h2 id="latest-h">${category.label}</h2></div>
  ${grid}
</section>`;

  return renderPageShell(
    renderHead(`${category.label} | مدونة سين`, `مقالات عن ${category.label} في مدونة سين.`, `https://seentech.io/blog/category/${category.slug}`),
    mainContent,
    'category'
  );
}
