import { describe, expect, test } from 'vitest';
import path from 'node:path';
import { loadArticles } from './frontmatter';
import { parseArticleSections } from './parseArticleSections';
import { renderArticlePage } from './templates/articlePage';
import { renderCategoryPage, renderIndexPage } from './templates/indexPage';
import { renderSideCta, renderSiteHeader, renderStickyMobileCta } from './templates/shared';
import { CATEGORIES } from './categories';
import { SIGNUP_URL } from './siteOrigin';

// seen-blog-cta-to-signup-task.md: every blog button opens the sign-up screen,
// on every page actually built from content/blog.
const CTA = /<a class="btn btn-cta[^"]*" href="([^"]+)" data-track="(cta_[a-z_]+)"/g;

function ctas(html: string): Array<{ href: string; track: string }> {
  return [...html.matchAll(CTA)].map((m) => ({ href: m[1], track: m[2] }));
}

describe('the blog buttons open the sign-up screen', () => {
  test('the sign-up address is the landing page\'s own', () => {
    expect(SIGNUP_URL).toBe('https://www.seentech.io/login?view=register');
  });

  test('header, mobile bar and side box', () => {
    for (const html of [renderSiteHeader(), renderStickyMobileCta(), renderSideCta()]) {
      const found = ctas(html);
      expect(found.length).toBeGreaterThan(0);
      for (const c of found) expect(c.href).toBe(SIGNUP_URL);
    }
  });

  test('every built page: each button goes to sign-up (tracking kept), no #book anywhere', async () => {
    const articles = loadArticles(path.resolve(__dirname, '../../content/blog'));
    const pages = [renderIndexPage(articles), ...CATEGORIES.map((c) => renderCategoryPage(c, articles.filter((a) => a.frontmatter.cluster === c.slug)))];
    for (const article of articles) {
      pages.push(renderArticlePage(article, await parseArticleSections(article.rawBody), articles));
    }
    const tracks = new Set<string>();
    for (const html of pages) {
      expect(html).not.toContain('#book');
      for (const c of ctas(html)) {
        expect(c.href).toBe(SIGNUP_URL);
        tracks.add(c.track);
      }
    }
    expect([...tracks]).toEqual(expect.arrayContaining(['cta_header', 'cta_sticky', 'cta_blog_index']));
    if (articles.some((a) => a.rawBody.includes('وين تدخل منصة سين'))) expect(tracks.has('cta_inline')).toBe(true);
  });
});
