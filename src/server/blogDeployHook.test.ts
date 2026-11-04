import { afterEach, describe, expect, test, vi } from 'vitest';
import { triggerBlogRebuild } from './blogDeployHook';

const ORIGINAL_ENV = { ...process.env };
const HOOK_URL = 'https://api.vercel.com/v1/integrations/deploy/test';

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('triggerBlogRebuild', () => {
  test('does nothing (no throw, no fetch) when BLOG_DEPLOY_HOOK_URL is unset', async () => {
    delete process.env.BLOG_DEPLOY_HOOK_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(triggerBlogRebuild()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
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
