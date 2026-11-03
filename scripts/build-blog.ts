import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadArticles } from './blog/frontmatter';
import { parseArticleSections } from './blog/parseArticleSections';
import { renderArticlePage } from './blog/templates/articlePage';
import { renderIndexPage, renderCategoryPage } from './blog/templates/indexPage';
import { renderSearchPage } from './blog/templates/searchPage';
import { buildSearchIndex } from './blog/search';
import { renderOgImagePng } from './blog/ogImage';
import { buildSitemapXml, buildRobotsTxt } from './blog/sitemap';
import { CATEGORIES } from './blog/categories';

function writePage(outDir: string, relativePath: string, html: string): void {
  const filePath = path.join(outDir, relativePath, 'index.html');
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, html);
}

export async function buildBlog(contentDir: string, outDir: string): Promise<void> {
  const articles = loadArticles(contentDir);

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

  const searchIndexPath = path.join(outDir, 'blog', 'search-index.json');
  mkdirSync(path.dirname(searchIndexPath), { recursive: true });
  writeFileSync(searchIndexPath, JSON.stringify(buildSearchIndex(articles)));

  const ogDir = path.join(outDir, 'blog', 'og');
  mkdirSync(ogDir, { recursive: true });
  for (const article of articles) {
    const png = await renderOgImagePng(article.frontmatter.title);
    writeFileSync(path.join(ogDir, `${article.slug}.png`), png);
  }

  const urls = [
    'https://seentech.io/blog/',
    ...articles.map(a => a.canonicalUrl),
    ...CATEGORIES.map(c => `https://seentech.io/blog/category/${c.slug}`),
  ];
  writeFileSync(path.join(outDir, 'sitemap.xml'), buildSitemapXml(urls));
  writeFileSync(path.join(outDir, 'robots.txt'), buildRobotsTxt('https://seentech.io/sitemap.xml'));
}

if (require.main === module) {
  buildBlog('content/blog', 'dist').catch(err => {
    console.error('[blog] build failed:', err.message);
    process.exit(1);
  });
}
