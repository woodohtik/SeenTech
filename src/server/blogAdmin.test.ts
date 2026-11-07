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
    vi.spyOn(blogGitHub, 'listBlogFiles').mockResolvedValue([{ name: 'existing-slug.md', sha: 's1' }]);
    vi.spyOn(blogAdmin, 'fetchAllArticles').mockResolvedValue([
      {
        slug: 'existing-slug',
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
