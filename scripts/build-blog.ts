import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadArticles } from './blog/frontmatter';
import { parseArticleSections } from './blog/parseArticleSections';
import { renderArticlePage } from './blog/templates/articlePage';
import { renderIndexPage, renderCategoryPage } from './blog/templates/indexPage';
import { renderSearchPage } from './blog/templates/searchPage';
import { buildSearchIndex } from './blog/search';
import { renderOgImagePng } from './blog/ogImage';
import { buildSitemapXml, buildRobotsTxt, type SitemapUrl } from './blog/sitemap';
import { buildAnalyticsInitScript } from './blog/analytics';
import { isProductionBuild } from './blog/templates/shared';
import { CATEGORIES } from './blog/categories';

// This project is "type": "module" -- __dirname doesn't exist under ESM
// (same class of bug as the entry-point check below: a CommonJS global
// that's simply undefined here, not a runtime error from a missing file).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The most recent publishDate among a set of articles, used as a page's
// sitemap <lastmod> -- undefined (omit lastmod) when the set is empty,
// since an empty category page has no content whose change to date.
function latestPublishDate(articles: { frontmatter: { publishDate: string } }[]): string | undefined {
  if (articles.length === 0) return undefined;
  return articles.reduce((latest, a) => (a.frontmatter.publishDate > latest ? a.frontmatter.publishDate : latest), articles[0].frontmatter.publishDate);
}

function writePage(outDir: string, relativePath: string, html: string): void {
  const filePath = path.join(outDir, relativePath, 'index.html');
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, html);
}

export async function buildBlog(contentDir: string, outDir: string): Promise<void> {
  const articles = loadArticles(contentDir, new Date());

  writePage(outDir, 'blog', renderIndexPage(articles));

  for (const article of articles) {
    const parsed = parseArticleSections(article.rawBody);
    writePage(outDir, `blog/${article.slug}`, renderArticlePage(article, parsed, articles));
  }

  for (const category of CATEGORIES) {
    const articlesInCategory = articles.filter(a => a.frontmatter.cluster === category.slug);
    writePage(outDir, `blog/category/${category.slug}`, renderCategoryPage(category, articlesInCategory));
  }

  writePage(outDir, 'blog/search', renderSearchPage());

  const blogDir = path.join(outDir, 'blog');
  mkdirSync(blogDir, { recursive: true });
  // The one external <script> every blog template loads
  // (scripts/blog/templates/shared.ts's BLOG_CLIENT_SCRIPT_TAG) -- copied
  // verbatim, not transformed, since it's already plain static JS and
  // CSP's script-src 'self' requires it to be same-origin.
  copyFileSync(path.join(__dirname, 'blog/assets/blog-client.js'), path.join(blogDir, 'blog.js'));
  // Analytics init calls baked in at build time from blogConfig's
  // (git-committed, trusted) tracking IDs -- see scripts/blog/analytics.ts.
  // Only ever referenced by a page when at least one id is configured.
  writeFileSync(path.join(blogDir, 'blog-config.js'), buildAnalyticsInitScript());

  const searchIndexPath = path.join(outDir, 'blog', 'search-index.json');
  mkdirSync(path.dirname(searchIndexPath), { recursive: true });
  writeFileSync(searchIndexPath, JSON.stringify(buildSearchIndex(articles)));

  const ogDir = path.join(outDir, 'blog', 'og');
  mkdirSync(ogDir, { recursive: true });
  for (const article of articles) {
    const png = await renderOgImagePng(article.frontmatter.title);
    writeFileSync(path.join(ogDir, `${article.slug}.png`), png);
  }

  const urls: SitemapUrl[] = [
    { url: 'https://seentech.io/blog/', lastmod: latestPublishDate(articles) },
    ...articles.map(a => ({ url: a.canonicalUrl, lastmod: a.frontmatter.publishDate })),
    ...CATEGORIES.map(c => ({
      url: `https://seentech.io/blog/category/${c.slug}`,
      lastmod: latestPublishDate(articles.filter(a => a.frontmatter.cluster === c.slug)),
    })),
  ];
  writeFileSync(path.join(outDir, 'sitemap.xml'), buildSitemapXml(urls));
  writeFileSync(path.join(outDir, 'robots.txt'), buildRobotsTxt('https://seentech.io/sitemap.xml', isProductionBuild()));
}

// Project is "type": "module" -- require.main/module aren't available
// under ESM, so detect direct execution the ESM way instead. Comparing
// import.meta.url to a hand-built `file://${process.argv[1]}` string
// breaks on Windows (backslash path vs the forward-slash/percent-encoded
// URL import.meta.url actually produces) -- pathToFileURL does the
// platform-correct conversion on both sides.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildBlog('content/blog', 'dist').catch(err => {
    console.error('[blog] build failed:', err.message);
    process.exit(1);
  });
}
