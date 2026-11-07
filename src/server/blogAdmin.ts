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
import { getCategory } from '../../scripts/blog/categories.ts';
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

/**
 * Rejects a `:slug` route param that could escape `content/blog/` (path
 * traversal via Express's own `%2F`/`..` decoding) -- e.g.
 * `..%2F..%2FCLAUDE` decodes to `../../CLAUDE` before this ever sees it,
 * which would otherwise resolve to a file well outside the blog directory.
 *
 * Deliberately NOT `slugify(slug) === slug`: slugify() strips hyphens as
 * punctuation (they only ever appear in its OUTPUT by replacing whitespace),
 * so it is not idempotent -- running it on an already-hyphenated real slug
 * (e.g. "existing-slug") produces "existingslug" and would reject every
 * normal multi-word article. Instead this allows exactly the characters
 * slugify() can ever emit (letters, combining marks, digits, hyphens) and
 * separately blocks the traversal-specific characters.
 */
function isValidSlug(slug: unknown): boolean {
  if (typeof slug !== 'string' || slug.length === 0) return false;
  if (slug.includes('/') || slug.includes('\\') || slug.includes('..')) return false;
  return /^[\p{L}\p{M}\p{N}-]+$/u.test(slug);
}

/**
 * Extra validation beyond `validateFrontmatter`'s own rules, run BEFORE
 * `slugify(title)` or any GitHub call. Needed because:
 *  - `validateFrontmatter` never checks `cluster` against the 8 fixed
 *    category slugs (only `parseArticleFrontmatter`/`loadArticles` do), so an
 *    invalid cluster would otherwise get committed to GitHub and break the
 *    NEXT build's `loadArticles` run for everyone.
 *  - a non-string `title`/`body` would throw an uncaught TypeError (e.g. from
 *    `slugify(title)` or `matter.stringify`) before validation ever runs,
 *    surfacing as a raw 500 instead of a clean 400.
 *  - a `title` that slugifies to an empty string (only punctuation/emoji)
 *    would otherwise produce a file literally named `content/blog/.md`.
 * Shared by createArticle and updateArticle so the rule lives in one place.
 */
function validateArticleInput(fields: ArticleInputFields, body: unknown): string | null {
  if (typeof fields.title !== 'string') {
    return 'title must be a string';
  }
  if (typeof body !== 'string') {
    return 'body must be a string';
  }
  if (!getCategory(fields.cluster)) {
    return `invalid cluster "${fields.cluster}" — must be one of the eight fixed category slugs`;
  }
  if (slugify(fields.title).length === 0) {
    return 'title must produce a non-empty slug';
  }
  return null;
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
  // One unparseable file (malformed frontmatter, a non-.md fluke that slipped
  // past listBlogFiles' filter, ...) must not take down the whole list/
  // create/preview flow via Promise.all -- skip and log just that one file,
  // and still return the rest.
  const results = await Promise.all(
    files.map(async file => {
      try {
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
      } catch (err) {
        console.warn(`[blog] skipping ${file.name}: failed to parse`, err);
        return null;
      }
    })
  );
  return results.filter((article): article is LoadedArticle => article !== null);
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
  if (!isValidSlug(req.params.slug)) {
    res.status(400).json({ error: 'invalid slug' });
    return;
  }
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

  const inputError = validateArticleInput(fields, body);
  if (inputError) {
    res.status(400).json({ error: inputError });
    return;
  }

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
  // Compares against the article's FILENAME (slug), not its current title --
  // an article's filename doesn't change when its title is later edited, so
  // comparing titles can miss a real collision (surfacing GitHub's own 422 as
  // a generic 502 instead of this route's clear 409) or stale-match a wrong one.
  const collision = existingArticles.find(article => article.slug === slug);
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
  if (!isValidSlug(slug)) {
    res.status(400).json({ error: 'invalid slug' });
    return;
  }
  const filename = `${slug}.md`;
  const { title, metaDescription, cluster, publishDate, related, body } = req.body;
  const fields: ArticleInputFields = { title, metaDescription, cluster, publishDate, related };

  const inputError = validateArticleInput(fields, body);
  if (inputError) {
    res.status(400).json({ error: inputError });
    return;
  }

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
  if (!isValidSlug(slug)) {
    res.status(400).json({ error: 'invalid slug' });
    return;
  }
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

  const parsed = await parseArticleSections(body);
  const html = renderArticlePage(syntheticArticle, parsed, allArticles);
  res.status(200).json({ html });
}
