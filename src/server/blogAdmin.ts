/**
 * Express route handlers for the GitHub-backed blog admin editor.
 *
 * Every handler validates the request body with `validateFrontmatter`'s own
 * rules BEFORE ever touching GitHub, so a 400 never triggers a wasted (or
 * dangerous) write. Writes always go: validate -> read-before-write (for
 * optimistic concurrency on update/delete) -> write -> best-effort
 * `triggerBlogRebuild()` -> respond. `triggerBlogRebuild()` is only ever
 * called after a GitHub write actually succeeds.
 *
 * `blogGitHub` and `blogDeployHook` are imported as namespaces (not named
 * imports) so tests can `vi.spyOn(blogGitHub, 'getBlogFile')` etc. -- named
 * ESM bindings are live but read-only and `vi.spyOn` can't intercept them.
 */
import matter from 'gray-matter';
import { parseArticleFrontmatter, validateFrontmatter, type LoadedArticle } from '../../scripts/blog/frontmatter.ts';
import { parseArticleSections } from '../../scripts/blog/parseArticleSections.ts';
import { renderArticlePage } from '../../scripts/blog/templates/articlePage.ts';
import { slugify } from '../utils/slugify.ts';
import * as blogGitHub from './blogGitHub.ts';
import * as blogDeployHook from './blogDeployHook.ts';
// Self-import: calls from inside this module to `thisModule.fetchAllArticles()`
// (instead of the bare identifier) go through this module's own namespace
// object, which is what lets a test's `vi.spyOn(blogAdmin, 'fetchAllArticles')`
// intercept it -- a bare in-module call would bind directly to the local
// function declaration and bypass any spy on the exports object.
import * as thisModule from './blogAdmin.ts';

const WORDS_PER_MINUTE = 180;
const MIN_READ_TIME_MINUTES = 2;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The camelCase shape `req.body` carries for create/update. */
interface ArticleInputFields {
  title: string;
  metaDescription: string;
  cluster: string;
  publishDate: string;
  related: string[];
}

/** Maps the request body's camelCase fields to the snake_case shape `validateFrontmatter`/`gray-matter` expect. */
function toFrontmatterData(fields: ArticleInputFields): Record<string, unknown> {
  return {
    title: fields.title,
    meta_description: fields.metaDescription,
    cluster: fields.cluster,
    publish_date: fields.publishDate,
    related: fields.related,
  };
}

/** Builds the full Markdown file content (frontmatter block + body) for a GitHub write. */
function buildMarkdown(fields: ArticleInputFields, body: string): string {
  return matter.stringify(body, toFrontmatterData(fields));
}

// Maps ANY failure from a GitHub read/write (a BlogGitHubError with GitHub's
// own message, or a plain Error such as a network/DNS failure from the
// unguarded `fetch()` calls in blogGitHub.ts) to the 502 the brief's
// response-shape table promises for "GitHub failure". Never rethrows --
// every call site uses this so no GitHub-adjacent failure can escape a
// handler as an unhandled rejection.
function respondWithGitHubError(res: any, err: unknown): void {
  res.status(502).json({ error: err instanceof Error ? err.message : 'unknown error' });
}

/**
 * Every content/blog/*.md file on the configured branch, parsed via
 * `parseArticleFrontmatter`. Deliberately includes scheduled/future-dated
 * articles (unlike the build-time `loadArticles`) -- the admin list view
 * needs to show them, and Task 6's preview-time related-article resolution
 * needs to find them too.
 */
export async function fetchAllArticles(): Promise<LoadedArticle[]> {
  const files = await blogGitHub.listBlogFiles();
  return Promise.all(
    files.map(async file => {
      const blogFile = await blogGitHub.getBlogFile(file.name);
      const { frontmatter, rawBody } = parseArticleFrontmatter(file.name, blogFile.content);
      const slug = file.name.replace(/\.md$/, '');
      const readTimeMinutes = Math.max(MIN_READ_TIME_MINUTES, Math.ceil(countWords(rawBody) / WORDS_PER_MINUTE));
      return {
        slug,
        frontmatter,
        rawBody,
        readTimeMinutes,
        canonicalUrl: `https://seentech.io/blog/${slug}`,
      };
    })
  );
}

/** GET /api/admin/blog/articles */
export async function listArticles(req: any, res: any): Promise<void> {
  const articles = await thisModule.fetchAllArticles();
  const now = new Date();
  res.status(200).json({
    articles: articles.map(article => ({
      slug: article.slug,
      title: article.frontmatter.title,
      cluster: article.frontmatter.cluster,
      publishDate: article.frontmatter.publishDate,
      status: new Date(article.frontmatter.publishDate) <= now ? 'published' : 'scheduled',
    })),
  });
}

/** GET /api/admin/blog/articles/:slug */
export async function getArticle(req: any, res: any): Promise<void> {
  const filename = `${req.params.slug}.md`;
  try {
    const file = await blogGitHub.getBlogFile(filename);
    const { frontmatter, rawBody } = parseArticleFrontmatter(filename, file.content);
    res.status(200).json({
      title: frontmatter.title,
      metaDescription: frontmatter.metaDescription,
      cluster: frontmatter.cluster,
      publishDate: frontmatter.publishDate,
      related: frontmatter.related,
      body: rawBody,
    });
  } catch (err) {
    if (err instanceof blogGitHub.BlogGitHubError && err.status === 404) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    respondWithGitHubError(res, err);
  }
}

/** POST /api/admin/blog/articles */
export async function createArticle(req: any, res: any): Promise<void> {
  const { title, metaDescription, cluster, publishDate, related, body } = req.body;
  const fields: ArticleInputFields = { title, metaDescription, cluster, publishDate, related };
  const slug = slugify(title);
  const filename = `${slug}.md`;

  try {
    validateFrontmatter(filename, toFrontmatterData(fields));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'invalid article' });
    return;
  }

  let existingArticles: LoadedArticle[];
  try {
    existingArticles = await thisModule.fetchAllArticles();
  } catch (err) {
    respondWithGitHubError(res, err);
    return;
  }
  const collision = existingArticles.find(article => slugify(article.frontmatter.title) === slug);
  if (collision) {
    res.status(409).json({ error: 'an article with this slug already exists', existingTitle: collision.frontmatter.title });
    return;
  }

  const fullMarkdown = buildMarkdown(fields, body);
  try {
    await blogGitHub.createBlogFile(filename, fullMarkdown, `feat(blog): add ${title}`);
  } catch (err) {
    respondWithGitHubError(res, err);
    return;
  }

  await blogDeployHook.triggerBlogRebuild();
  res.status(200).json({ slug });
}

/** PUT /api/admin/blog/articles/:slug */
export async function updateArticle(req: any, res: any): Promise<void> {
  const { slug } = req.params;
  const filename = `${slug}.md`;
  const { title, metaDescription, cluster, publishDate, related, body } = req.body;
  const fields: ArticleInputFields = { title, metaDescription, cluster, publishDate, related };

  try {
    validateFrontmatter(filename, toFrontmatterData(fields));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'invalid article' });
    return;
  }

  let sha: string;
  try {
    const current = await blogGitHub.getBlogFile(filename);
    sha = current.sha;
  } catch (err) {
    if (err instanceof blogGitHub.BlogGitHubError && err.status === 404) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    respondWithGitHubError(res, err);
    return;
  }

  const fullMarkdown = buildMarkdown(fields, body);
  try {
    await blogGitHub.updateBlogFile(filename, fullMarkdown, sha, `feat(blog): update ${title}`);
  } catch (err) {
    respondWithGitHubError(res, err);
    return;
  }

  await blogDeployHook.triggerBlogRebuild();
  res.status(200).json({ slug });
}

/** DELETE /api/admin/blog/articles/:slug */
export async function deleteArticle(req: any, res: any): Promise<void> {
  const { slug } = req.params;
  const filename = `${slug}.md`;

  let sha: string;
  try {
    const current = await blogGitHub.getBlogFile(filename);
    sha = current.sha;
  } catch (err) {
    if (err instanceof blogGitHub.BlogGitHubError && err.status === 404) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    respondWithGitHubError(res, err);
    return;
  }

  try {
    await blogGitHub.deleteBlogFile(filename, sha, `feat(blog): delete ${slug}`);
  } catch (err) {
    respondWithGitHubError(res, err);
    return;
  }

  await blogDeployHook.triggerBlogRebuild();
  res.status(200).json({});
}

/**
 * POST /api/admin/blog/preview
 *
 * Read-only: renders unsaved form state through the REAL public-site
 * rendering path (`parseArticleSections` + `renderArticlePage`) so the
 * preview matches production exactly. Must never call any `blogGitHub`
 * write function or `triggerBlogRebuild()` -- there is nothing to save
 * here, only to render.
 */
export async function previewArticle(req: any, res: any): Promise<void> {
  const { title, metaDescription, cluster, publishDate, related, body } = req.body;
  const fields: ArticleInputFields = { title, metaDescription, cluster, publishDate, related };

  try {
    validateFrontmatter('preview.md', toFrontmatterData(fields));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'invalid article' });
    return;
  }

  let allArticles: LoadedArticle[];
  try {
    allArticles = await thisModule.fetchAllArticles();
  } catch (err) {
    respondWithGitHubError(res, err);
    return;
  }

  const readTimeMinutes = Math.max(MIN_READ_TIME_MINUTES, Math.ceil(countWords(body) / WORDS_PER_MINUTE));
  const syntheticArticle: LoadedArticle = {
    slug: 'preview',
    frontmatter: { title, metaDescription, cluster, publishDate, related },
    rawBody: body,
    readTimeMinutes,
    canonicalUrl: 'https://seentech.io/blog/preview',
  };

  const parsed = parseArticleSections(body);
  const html = renderArticlePage(syntheticArticle, parsed, allArticles);
  res.status(200).json({ html });
}
