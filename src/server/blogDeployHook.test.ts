import { afterEach, describe, expect, test, vi } from 'vitest';
import { triggerBlogRebuild } from './blogDeployHook';

const ORIGINAL_ENV = { ...process.env };
const HOOK_URL = 'https://api.vercel.com/v1/integrations/deploy/test';

function githubEnv() {
  process.env.BLOG_GITHUB_TOKEN = 'test-token';
  process.env.BLOG_GITHUB_REPO = 'owner/repo';
  process.env.BLOG_GITHUB_BRANCH = 'main';
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('triggerBlogRebuild', () => {
  // I1/I2: no Deploy Hook configured for this environment must not mean "do
  // nothing" -- that silent no-op is exactly what broke scheduled publishing
  // in production (nobody had created a per-environment Deploy Hook there).
  // Fall back to a trivial GitHub commit on the same branch/token the blog
  // editor already writes articles with, which Vercel's existing git-push
  // pipeline picks up on its own -- no new secret to remember to configure.
  test('falls back to a GitHub marker-file commit when BLOG_DEPLOY_HOOK_URL is unset and no marker file exists yet', async () => {
    delete process.env.BLOG_DEPLOY_HOOK_URL;
    githubEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ message: 'Not Found' }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(triggerBlogRebuild()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [getUrl] = fetchMock.mock.calls[0];
    const [putUrl, putInit] = fetchMock.mock.calls[1];
    expect(getUrl).toContain('content/blog/.rebuild-trigger');
    expect(putUrl).toContain('content/blog/.rebuild-trigger');
    expect(putInit).toEqual(expect.objectContaining({ method: 'PUT' }));
    const body = JSON.parse(putInit.body);
    expect(body.sha).toBeUndefined();
    expect(body.branch).toBe('main');
  });

  test('updates the existing marker file (with its sha) when one is already present', async () => {
    delete process.env.BLOG_DEPLOY_HOOK_URL;
    githubEnv();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ path: 'content/blog/.rebuild-trigger', sha: 'abc123', content: Buffer.from('old').toString('base64') }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(triggerBlogRebuild()).resolves.toBeUndefined();
    const [, putInit] = fetchMock.mock.calls[1];
    const body = JSON.parse(putInit.body);
    expect(body.sha).toBe('abc123');
  });

  test('does not throw when the GitHub fallback itself fails', async () => {
    delete process.env.BLOG_DEPLOY_HOOK_URL;
    githubEnv();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(triggerBlogRebuild()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  test('POSTs to the configured hook URL', async () => {
    process.env.BLOG_DEPLOY_HOOK_URL = HOOK_URL;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    await triggerBlogRebuild();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(HOOK_URL);
    expect(init).toEqual(expect.objectContaining({ method: 'POST' }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test('does not throw when the hook responds with a non-2xx status', async () => {
    process.env.BLOG_DEPLOY_HOOK_URL = HOOK_URL;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(triggerBlogRebuild()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), 500);
  });

  test('does not throw and does not hang when the request itself errors (network failure)', async () => {
    process.env.BLOG_DEPLOY_HOOK_URL = HOOK_URL;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(triggerBlogRebuild()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
