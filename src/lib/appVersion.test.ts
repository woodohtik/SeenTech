// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRemoteVersion, isNewerBuild, startVersionChecks, noteNavigation } from './appVersion';

// seen-update-delivery-fix-task.md, phase 2: learn about a new build from
// /version.json, not only from the service worker.

const json = (body: unknown, ok = true) => vi.fn().mockResolvedValue({ ok, json: async () => body });

describe('fetchRemoteVersion', () => {
  it('asks for /version.json without any cache', async () => {
    const fetchImpl = json({ build: 'b2', builtAt: 'x', mandatory: false });
    expect(await fetchRemoteVersion(fetchImpl)).toEqual({ build: 'b2', builtAt: 'x', mandatory: false });
    expect(fetchImpl).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });
  });

  it('offline, an error page or a broken file is ignored quietly (null)', async () => {
    expect(await fetchRemoteVersion(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))).toBeNull();
    expect(await fetchRemoteVersion(json({}, false))).toBeNull();
    expect(await fetchRemoteVersion(json({ nope: 1 }))).toBeNull();
    expect(await fetchRemoteVersion(vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('html'); } }))).toBeNull();
  });
});

describe('isNewerBuild', () => {
  it('a different build is an update; the same one, or a local dev build, is not', () => {
    expect(isNewerBuild({ build: 'b2' }, 'b1')).toBe(true);
    expect(isNewerBuild({ build: 'b1' }, 'b1')).toBe(false);
    expect(isNewerBuild({ build: 'b2' }, 'dev')).toBe(false);
    expect(isNewerBuild(null, 'b1')).toBe(false);
  });
});

describe('startVersionChecks', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('checks at start, every 10 minutes, on return to the tab, on reconnect and on navigation -- at most once a minute', async () => {
    const fetchImpl = json({ build: 'b1' });
    const onUpdate = vi.fn();
    const stop = startVersionChecks({ current: 'b1', onUpdate, fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // start

    noteNavigation();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // under a minute: skipped

    await vi.advanceTimersByTimeAsync(61_000);
    noteNavigation();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // navigation

    await vi.advanceTimersByTimeAsync(61_000);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // reconnect

    await vi.advanceTimersByTimeAsync(61_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // back to the tab

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(5); // the 10-minute tick
    expect(onUpdate).not.toHaveBeenCalled();
    stop();
  });

  it('reports a newer build once', async () => {
    const fetchImpl = json({ build: 'b2', mandatory: true });
    const onUpdate = vi.fn();
    const stop = startVersionChecks({ current: 'b1', onUpdate, fetchImpl });
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledWith({ build: 'b2', mandatory: true });
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    stop();
  });
});
