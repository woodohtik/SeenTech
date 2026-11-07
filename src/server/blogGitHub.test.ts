import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BlogGitHubError, createBlogFile, deleteBlogFile, getBlogFile, listBlogFiles, updateBlogFile } from './blogGitHub';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.BLOG_GITHUB_TOKEN = 'test-token';
  process.env.BLOG_GITHUB_REPO = 'seen/blog-content';
  process.env.BLOG_GITHUB_BRANCH = 'main';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('blogGitHub config', () => {
  test('throws naming the first missing required env var', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    delete process.env.BLOG_GITHUB_TOKEN;
    await expect(listBlogFiles()).rejects.toThrow(/BLOG_GITHUB_TOKEN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('getBlogFile', () => {
  test('getBlogFile decodes base64 content and returns the sha', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        path: 'content/blog/how-to.md',
        sha: 'abc123',
        content: Buffer.from('---\ntitle: x\n---\n').toString('base64'),
        encoding: 'base64',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const file = await getBlogFile('how-to.md');
    expect(file.sha).toBe('abc123');
    expect(file.content).toContain('title: x');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/seen/blog-content/contents/content/blog/how-to.md?ref=main'
    );
  });

  test('getBlogFile throws BlogGitHubError with status 404 when GitHub returns 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ message: 'Not Found' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getBlogFile('missing.md')).rejects.toMatchObject({ status: 404 });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/seen/blog-content/contents/content/blog/missing.md?ref=main'
    );
  });

  test('getBlogFile throws BlogGitHubError (not a raw parse error) when a non-2xx response body is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      })
    );
    await expect(getBlogFile('broken.md')).rejects.toBeInstanceOf(BlogGitHubError);
  });
});

describe('listBlogFiles', () => {
  // Regression: content/blog/README.md genuinely exists on this branch and is
  // docs, not an article -- loadArticles (scripts/blog/frontmatter.ts) already
  // excludes it case-insensitively at build time, and listBlogFiles must match
  // that rule exactly or the admin list/create/preview flows choke on it.
  test('listBlogFiles requests the content/blog directory, filters to .md files, and excludes README.md case-insensitively', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { name: 'a.md', sha: 'sha-a', type: 'file' },
        { name: 'README.md', sha: 'sha-readme', type: 'file' },
        { name: 'readme.md', sha: 'sha-readme-lower', type: 'file' },
        { name: 'not-markdown.txt', sha: 'sha-txt', type: 'file' },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const files = await listBlogFiles();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/seen/blog-content/contents/content/blog?ref=main');
    expect(files).toEqual([{ name: 'a.md', sha: 'sha-a' }]);
  });

  test('listBlogFiles throws BlogGitHubError (not a raw parse error) when a non-2xx response body is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      })
    );
    await expect(listBlogFiles()).rejects.toBeInstanceOf(BlogGitHubError);
  });
});

describe('createBlogFile / updateBlogFile / deleteBlogFile', () => {
  test('createBlogFile PUTs base64 content with no sha', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await createBlogFile('new.md', 'body', 'feat: add new.md');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/seen/blog-content/contents/content/blog/new.md');
    const body = JSON.parse(init.body);
    expect(body.sha).toBeUndefined();
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe('body');
    expect(body.branch).toBe(process.env.BLOG_GITHUB_BRANCH);
  });

  test("createBlogFile throws BlogGitHubError with GitHub's message on a 422 (e.g. file already exists)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ message: "sha wasn't supplied" }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(createBlogFile('exists.md', 'body', 'msg')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("sha wasn't supplied"),
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/seen/blog-content/contents/content/blog/exists.md');
  });

  test('updateBlogFile PUTs with the given sha', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await updateBlogFile('existing.md', 'new body', 'sha1', 'feat: update');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/seen/blog-content/contents/content/blog/existing.md');
    expect(JSON.parse(init.body).sha).toBe('sha1');
  });

  test('deleteBlogFile DELETEs with the given sha', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await deleteBlogFile('gone.md', 'sha2', 'feat: delete');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/seen/blog-content/contents/content/blog/gone.md');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body).sha).toBe('sha2');
  });
});
