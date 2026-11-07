import { afterEach, describe, expect, test, vi } from 'vitest';
import * as blogAdmin from './blogAdmin.ts';
import { fetchAllArticles, listArticles, getArticle, createArticle, updateArticle, deleteArticle, previewArticle } from './blogAdmin.ts';
import * as blogGitHub from './blogGitHub.ts';
import * as blogDeployHook from './blogDeployHook.ts';
import { BlogGitHubError } from './blogGitHub.ts';

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b: any) => {
    res.body = b;
    return res;
  };
  return res;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchAllArticles', () => {
  test('fetchAllArticles parses every file listBlogFiles returns, including future-dated ones', async () => {
    vi.spyOn(blogGitHub, 'listBlogFiles').mockResolvedValue([{ name: 'a.md', sha: 's1' }]);
    vi.spyOn(blogGitHub, 'getBlogFile').mockResolvedValue({
      path: 'content/blog/a.md',
      sha: 's1',
      content:
        '---\ntitle: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2099-01-01T00:00:00Z"\nrelated: []\n---\n\nنص.',
    });
    const articles = await fetchAllArticles();
    expect(articles).toHaveLength(1);
    expect(articles[0].frontmatter.title).toBe('ق');
  });

  // Regression (C2): one unparseable file (malformed frontmatter here) must
  // not take down the whole Promise.all -- it should be skipped and logged,
  // with every other file still returned.
  test('fetchAllArticles skips a file that fails to parse and still returns the rest', async () => {
    vi.spyOn(blogGitHub, 'listBlogFiles').mockResolvedValue([
      { name: 'broken.md', sha: 's0' },
      { name: 'a.md', sha: 's1' },
    ]);
    vi.spyOn(blogGitHub, 'getBlogFile').mockImplementation(async (name: string) => {
      if (name === 'broken.md') {
        return {
          path: `content/blog/${name}`,
          sha: 's0',
          // Missing title/meta_description and an invalid cluster -- fails parseArticleFrontmatter.
          content: '---\ncluster: not-a-real-cluster\n---\n\nنص بلا عنوان.',
        };
      }
      return {
        path: `content/blog/${name}`,
        sha: 's1',
        content:
          '---\ntitle: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2099-01-01T00:00:00Z"\nrelated: []\n---\n\nنص.',
      };
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const articles = await fetchAllArticles();
    expect(articles).toHaveLength(1);
    expect(articles[0].slug).toBe('a');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('broken.md'), expect.anything());
  });
});

describe('listArticles', () => {
  test('listArticles marks a future publishDate as scheduled and a past one as published', async () => {
    vi.spyOn(blogAdmin, 'fetchAllArticles').mockResolvedValue([
      {
        slug: 'future',
        frontmatter: { title: 'ق', metaDescription: 'و', cluster: 'orders', publishDate: '2099-01-01T00:00:00Z', related: [] },
        rawBody: '',
        readTimeMinutes: 2,
        canonicalUrl: '',
      },
      {
        slug: 'past',
        frontmatter: { title: 'س', metaDescription: 'ص', cluster: 'orders', publishDate: '2020-01-01T00:00:00Z', related: [] },
        rawBody: '',
        readTimeMinutes: 2,
        canonicalUrl: '',
      },
    ]);
    const res = mockRes();
    await listArticles({} as any, res);
    const byStatus = Object.fromEntries(res.body.articles.map((a: any) => [a.slug, a.status]));
    expect(byStatus.future).toBe('scheduled');
    expect(byStatus.past).toBe('published');
  });
});

describe('createArticle', () => {
  test("createArticle validates with validateFrontmatter's own rules before ever calling GitHub", async () => {
    const createSpy = vi.spyOn(blogGitHub, 'createBlogFile');
    const res = mockRes();
    await createArticle({ body: { title: '', metaDescription: 'و', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(createSpy).not.toHaveBeenCalled();
  });

  test('createArticle derives the slug from the title and commits via createBlogFile', async () => {
    vi.spyOn(blogGitHub, 'listBlogFiles').mockResolvedValue([]);
    const createSpy = vi.spyOn(blogGitHub, 'createBlogFile').mockResolvedValue(undefined);
    const hookSpy = vi.spyOn(blogDeployHook, 'triggerBlogRebuild').mockResolvedValue(undefined);
    const res = mockRes();
    await createArticle(
      { body: { title: 'عنوان جديد', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص المقالة' } } as any,
      res
    );
    expect(res.statusCode).toBe(200);
    expect(createSpy).toHaveBeenCalledWith(expect.stringContaining('.md'), expect.any(String), expect.any(String));
    expect(hookSpy).toHaveBeenCalled();
  });

  test('createArticle returns 409 with the existing title when the derived slug is already taken', async () => {
    // The collision check now compares against the article's FILENAME
    // (slug), not its current title (I4) -- so this mock's `slug` must be
    // consistent with slugify(title), i.e. what createArticle would actually
    // derive from this same title, instead of an arbitrary Latin string.
    vi.spyOn(blogGitHub, 'listBlogFiles').mockResolvedValue([{ name: 'العنوان-الموجود.md', sha: 's1' }]);
    vi.spyOn(blogAdmin, 'fetchAllArticles').mockResolvedValue([
      {
        slug: 'العنوان-الموجود',
        frontmatter: { title: 'العنوان الموجود', metaDescription: 'و', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [] },
        rawBody: '',
        readTimeMinutes: 2,
        canonicalUrl: '',
      },
    ]);
    const res = mockRes();
    await createArticle(
      { body: { title: 'العنوان الموجود', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any,
      res
    );
    expect(res.statusCode).toBe(409);
    expect(res.body.existingTitle).toBe('العنوان الموجود');
  });

  // Regression (I4): the collision check must key off the existing article's
  // FILENAME (slug), not its current title. An article's title can be edited
  // after creation without its filename/slug changing -- the old
  // `slugify(article.frontmatter.title) === slug` comparison would miss this
  // real collision entirely (letting GitHub's own 422 surface as a generic
  // 502 instead of this route's clear 409).
  test('createArticle detects a collision via article.slug even when the stored title no longer matches the candidate slug', async () => {
    vi.spyOn(blogGitHub, 'listBlogFiles').mockResolvedValue([{ name: 'my-slug.md', sha: 's1' }]);
    vi.spyOn(blogAdmin, 'fetchAllArticles').mockResolvedValue([
      {
        slug: 'my-slug',
        // Title was edited after creation -- no longer slugifies to "my-slug".
        frontmatter: { title: 'عنوان جديد كليا بعد التعديل', metaDescription: 'و', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [] },
        rawBody: '',
        readTimeMinutes: 2,
        canonicalUrl: '',
      },
    ]);
    const res = mockRes();
    await createArticle(
      { body: { title: 'my slug', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any,
      res
    );
    expect(res.statusCode).toBe(409);
    expect(res.body.existingTitle).toBe('عنوان جديد كليا بعد التعديل');
  });

  // Review Focus: a 422 from GitHub ITSELF (e.g. a second save raced in between our
  // own pre-check and the actual PUT, so GitHub rejects the create outright) is a
  // different shape than our own pre-check 409 above, and must not surface as an
  // opaque 500.
  test("createArticle returns 502 with GitHub's own message when createBlogFile itself rejects with a 422", async () => {
    vi.spyOn(blogGitHub, 'listBlogFiles').mockResolvedValue([]);
    vi.spyOn(blogGitHub, 'createBlogFile').mockRejectedValue(new BlogGitHubError('Invalid request.\n\n"sha" wasn\'t supplied.', 422));
    const res = mockRes();
    await createArticle(
      { body: { title: 'عنوان جديد', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any,
      res
    );
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain('sha');
  });

  // Regression: the slug-collision check's own GitHub read must not be able
  // to escape as an unhandled rejection -- any failure there (rate-limit,
  // 5xx, network) must still resolve to the brief's documented 502 shape.
  test('createArticle returns 502 (not an unhandled rejection) when the slug-collision check itself fails', async () => {
    vi.spyOn(blogGitHub, 'listBlogFiles').mockRejectedValue(new BlogGitHubError('GitHub request failed (503)', 503));
    const res = mockRes();
    await createArticle(
      { body: { title: 'عنوان جديد', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any,
      res
    );
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBeTruthy();
  });

  // Regression: a raw network/DNS failure from blogGitHub.ts's unguarded
  // fetch() calls throws a plain Error, not a BlogGitHubError. That must
  // still be mapped to 502, not rethrown/escape as an unhandled rejection.
  test('createArticle returns 502 when createBlogFile rejects with a plain (non-BlogGitHubError) Error', async () => {
    vi.spyOn(blogGitHub, 'listBlogFiles').mockResolvedValue([]);
    vi.spyOn(blogGitHub, 'createBlogFile').mockRejectedValue(new Error('network down'));
    const res = mockRes();
    await createArticle(
      { body: { title: 'عنوان جديد', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any,
      res
    );
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain('network down');
  });

  // I5: validateFrontmatter alone doesn't check `cluster` against the 8
  // fixed category slugs -- an invalid cluster must never reach GitHub,
  // because the NEXT build's loadArticles run would throw on it and break
  // the whole staging deploy, not just this feature.
  test('createArticle rejects an invalid cluster with 400 before ever calling GitHub', async () => {
    const createSpy = vi.spyOn(blogGitHub, 'createBlogFile');
    const res = mockRes();
    await createArticle(
      { body: { title: 'عنوان جديد', metaDescription: 'وصف', cluster: 'not-a-real-cluster', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any,
      res
    );
    expect(res.statusCode).toBe(400);
    expect(createSpy).not.toHaveBeenCalled();
  });

  // I5: a title that slugifies to an empty string (only punctuation/emoji)
  // would otherwise produce a file literally named content/blog/.md.
  test('createArticle rejects a title that slugifies to an empty string with 400', async () => {
    const createSpy = vi.spyOn(blogGitHub, 'createBlogFile');
    const res = mockRes();
    await createArticle(
      { body: { title: '!!! ??? ...', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any,
      res
    );
    expect(res.statusCode).toBe(400);
    expect(createSpy).not.toHaveBeenCalled();
  });

  // I5: a non-string title would otherwise throw an uncaught TypeError (from
  // slugify()) before any validation runs, surfacing as a raw 500.
  test('createArticle rejects a non-string title with 400, not a 500', async () => {
    const createSpy = vi.spyOn(blogGitHub, 'createBlogFile');
    const res = mockRes();
    await createArticle(
      { body: { title: 12345, metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any,
      res
    );
    expect(res.statusCode).toBe(400);
    expect(createSpy).not.toHaveBeenCalled();
  });

  // I5: updateArticle shares the same validation step -- proving it isn't
  // create-only.
  test('updateArticle rejects an invalid cluster with 400 before ever calling GitHub', async () => {
    const getSpy = vi.spyOn(blogGitHub, 'getBlogFile');
    const res = mockRes();
    await updateArticle(
      { params: { slug: 'x' }, body: { title: 'عنوان', metaDescription: 'وصف', cluster: 'not-a-real-cluster', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any,
      res
    );
    expect(res.statusCode).toBe(400);
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe('getArticle / updateArticle / deleteArticle', () => {
  test('getArticle 404s when the slug has no matching file', async () => {
    vi.spyOn(blogGitHub, 'getBlogFile').mockRejectedValue(new BlogGitHubError('not found', 404));
    const res = mockRes();
    await getArticle({ params: { slug: 'missing' } } as any, res);
    expect(res.statusCode).toBe(404);
  });

  test('getArticle returns the parsed frontmatter and body for an existing slug', async () => {
    vi.spyOn(blogGitHub, 'getBlogFile').mockResolvedValue({
      path: 'content/blog/x.md',
      sha: 's1',
      content: '---\ntitle: "ق"\nmeta_description: "و"\ncluster: orders\npublish_date: "2026-11-04T10:00:00Z"\nrelated: []\n---\n\nنص.',
    });
    const res = mockRes();
    await getArticle({ params: { slug: 'x' } } as any, res);
    expect(res.body.title).toBe('ق');
  });

  test('updateArticle fetches the current sha first, then updates with it', async () => {
    vi.spyOn(blogGitHub, 'getBlogFile').mockResolvedValue({ path: 'content/blog/x.md', sha: 'current-sha', content: '' });
    const updateSpy = vi.spyOn(blogGitHub, 'updateBlogFile').mockResolvedValue(undefined);
    vi.spyOn(blogDeployHook, 'triggerBlogRebuild').mockResolvedValue(undefined);
    const res = mockRes();
    await updateArticle(
      { params: { slug: 'x' }, body: { title: 'عنوان', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any,
      res
    );
    expect(updateSpy).toHaveBeenCalledWith('x.md', expect.any(String), 'current-sha', expect.any(String));
    expect(res.statusCode).toBe(200);
  });

  // Regression: same plain-Error-must-map-to-502 guarantee as createArticle's,
  // for the update write path.
  test('updateArticle returns 502 when updateBlogFile rejects with a plain (non-BlogGitHubError) Error', async () => {
    vi.spyOn(blogGitHub, 'getBlogFile').mockResolvedValue({ path: 'content/blog/x.md', sha: 'current-sha', content: '' });
    vi.spyOn(blogGitHub, 'updateBlogFile').mockRejectedValue(new Error('network down'));
    const res = mockRes();
    await updateArticle(
      { params: { slug: 'x' }, body: { title: 'عنوان', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any,
      res
    );
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain('network down');
  });

  test('deleteArticle fetches the current sha first, then deletes with it', async () => {
    vi.spyOn(blogGitHub, 'getBlogFile').mockResolvedValue({ path: 'content/blog/x.md', sha: 'current-sha', content: '' });
    const deleteSpy = vi.spyOn(blogGitHub, 'deleteBlogFile').mockResolvedValue(undefined);
    vi.spyOn(blogDeployHook, 'triggerBlogRebuild').mockResolvedValue(undefined);
    const res = mockRes();
    await deleteArticle({ params: { slug: 'x' } } as any, res);
    expect(deleteSpy).toHaveBeenCalledWith('x.md', 'current-sha', expect.any(String));
    expect(res.statusCode).toBe(200);
  });

  // I3 (security): Express decodes %2F inside a route param, so a request to
  // /api/admin/blog/articles/..%2F..%2FCLAUDE arrives here with
  // req.params.slug === '../../CLAUDE' -- without validation this would
  // resolve to a file well outside content/blog/, letting an authenticated
  // super_admin read/write/delete arbitrary .md files in the repo.
  test('getArticle rejects a path-traversal slug with 400 and never calls blogGitHub.getBlogFile', async () => {
    const getSpy = vi.spyOn(blogGitHub, 'getBlogFile');
    const res = mockRes();
    await getArticle({ params: { slug: '../../CLAUDE' } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid slug');
    expect(getSpy).not.toHaveBeenCalled();
  });

  test('updateArticle rejects a path-traversal slug with 400 and never calls blogGitHub.getBlogFile/updateBlogFile', async () => {
    const getSpy = vi.spyOn(blogGitHub, 'getBlogFile');
    const updateSpy = vi.spyOn(blogGitHub, 'updateBlogFile');
    const res = mockRes();
    await updateArticle(
      { params: { slug: '../../CLAUDE' }, body: { title: 'عنوان', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any,
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid slug');
    expect(getSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test('deleteArticle rejects a path-traversal slug with 400 and never calls blogGitHub.getBlogFile/deleteBlogFile', async () => {
    const getSpy = vi.spyOn(blogGitHub, 'getBlogFile');
    const deleteSpy = vi.spyOn(blogGitHub, 'deleteBlogFile');
    const res = mockRes();
    await deleteArticle({ params: { slug: '../../CLAUDE' } } as any, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('invalid slug');
    expect(getSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe('previewArticle', () => {
  test('previewArticle validates the same way create/update do', async () => {
    const res = mockRes();
    await previewArticle({ body: { title: '', metaDescription: 'و', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: 'نص' } } as any, res);
    expect(res.statusCode).toBe(400);
  });

  test('previewArticle renders the real article page HTML without touching GitHub or the deploy hook', async () => {
    vi.spyOn(blogAdmin, 'fetchAllArticles').mockResolvedValue([]);
    const createSpy = vi.spyOn(blogGitHub, 'createBlogFile');
    const hookSpy = vi.spyOn(blogDeployHook, 'triggerBlogRebuild');
    const res = mockRes();
    await previewArticle({ body: { title: 'عنوان المعاينة', metaDescription: 'وصف', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', related: [], body: '## قسم\nنص.' } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.html).toContain('عنوان المعاينة');
    expect(createSpy).not.toHaveBeenCalled();
    expect(hookSpy).not.toHaveBeenCalled();
  });
});
