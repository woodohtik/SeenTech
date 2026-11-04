import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createBlogFile, deleteBlogFile, getBlogFile, listBlogFiles, updateBlogFile } from './blogGitHub';

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
    delete process.env.BLOG_GITHUB_TOKEN;
    await expect(listBlogFiles()).rejects.toThrow(/BLOG_GITHUB_TOKEN/);
  });
});

describe('getBlogFile', () => {
  test('getBlogFile decodes base64 content and returns the sha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          path: 'content/blog/how-to.md',
          sha: 'abc123',
          content: Buffer.from('---\ntitle: x\n---\n').toString('base64'),
          encoding: 'base64',
        }),
      })
    );
    const file = await getBlogFile('how-to.md');
    expect(file.sha).toBe('abc123');
    expect(file.content).toContain('title: x');
  });

  test('getBlogFile throws BlogGitHubError with status 404 when GitHub returns 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ message: 'Not Found' }) })
    );
    await expect(getBlogFile('missing.md')).rejects.toMatchObject({ status: 404 });
  });
});

describe('createBlogFile / updateBlogFile / deleteBlogFile', () => {
  test('createBlogFile PUTs base64 content with no sha', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await createBlogFile('new.md', 'body', 'feat: add new.md');
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.sha).toBeUndefined();
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe('body');
    expect(body.branch).toBe(process.env.BLOG_GITHUB_BRANCH);
  });

  test("createBlogFile throws BlogGitHubError with GitHub's message on a 422 (e.g. file already exists)", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ message: "sha wasn't supplied" }) })
    );
    await expect(createBlogFile('exists.md', 'body', 'msg')).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("sha wasn't supplied"),
    });
  });

  test('updateBlogFile PUTs with the given sha', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await updateBlogFile('existing.md', 'new body', 'sha1', 'feat: update');
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).sha).toBe('sha1');
  });

  test('deleteBlogFile DELETEs with the given sha', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await deleteBlogFile('gone.md', 'sha2', 'feat: delete');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body).sha).toBe('sha2');
  });
});
