// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHUNK_RELOAD_KEY,
  claimAutoRecovery,
  hardRecover,
  isChunkLoadError,
  recoverFromStaleBuild,
} from './chunkRecovery';

// seen-update-delivery-fix-task.md, phase 0.5: one automatic try in 60
// seconds, then a calm screen with one button -- never a reload loop.

const reload = vi.fn();
beforeEach(() => {
  sessionStorage.clear();
  reload.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/assets/CartesianChart-abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/x.css',
  ])('knows %s', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('knows a ChunkLoadError by name, and nothing else', () => {
    const named = new Error('x');
    named.name = 'ChunkLoadError';
    expect(isChunkLoadError(named)).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('claimAutoRecovery: one automatic try in 60 seconds, for the whole app', () => {
  it('allows the first try, then refuses until 60 seconds have passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T10:00:00Z'));
    expect(claimAutoRecovery()).toBe(true);
    expect(claimAutoRecovery()).toBe(false);
    vi.setSystemTime(new Date('2026-11-25T10:00:59Z'));
    expect(claimAutoRecovery()).toBe(false);
    vi.setSystemTime(new Date('2026-11-25T10:01:01Z'));
    expect(claimAutoRecovery()).toBe(true);
  });

  it('survives a reload: the record is in sessionStorage, not in memory', () => {
    expect(claimAutoRecovery()).toBe(true);
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).not.toBeNull();
    expect(claimAutoRecovery()).toBe(false);
  });

  it('without storage it never tries automatically (a loop it could not count is worse)', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      expect(claimAutoRecovery()).toBe(false);
    } finally {
      getItem.mockRestore();
    }
  });
});

describe('recoverFromStaleBuild', () => {
  it('checks for a new worker, lets a waiting one take over, drops the on-demand chunk caches, then reloads', async () => {
    const postMessage = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { getRegistration: vi.fn().mockResolvedValue({ update, waiting: { postMessage } }) } });
    const deleted: string[] = [];
    vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue(['seen-on-demand-chunks', 'seen-on-demand-chunks-v2', 'workbox-precache-v2-x']), delete: vi.fn(async (name: string) => { deleted.push(name); return true; }) });
    await recoverFromStaleBuild();
    expect(update).toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(deleted.sort()).toEqual(['seen-on-demand-chunks', 'seen-on-demand-chunks-v2']);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still reloads when there is no service worker at all', async () => {
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: undefined });
    vi.stubGlobal('caches', undefined);
    await recoverFromStaleBuild();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not hang on a worker that never answers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { getRegistration: () => new Promise(() => {}) } });
    vi.stubGlobal('caches', undefined);
    const done = recoverFromStaleBuild();
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('hardRecover: the "update" button', () => {
  it('unregisters every worker and deletes every cache of the app, then reloads; IndexedDB is left alone', async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { getRegistrations: vi.fn().mockResolvedValue([{ unregister }, { unregister }]) } });
    const deleted: string[] = [];
    vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue(['workbox-precache-v2-x', 'seen-on-demand-chunks-v2', 'seen-pages']), delete: vi.fn(async (name: string) => { deleted.push(name); return true; }) });
    const idb = vi.fn();
    vi.stubGlobal('indexedDB', { deleteDatabase: idb });
    await hardRecover();
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(deleted.sort()).toEqual(['seen-on-demand-chunks-v2', 'seen-pages', 'workbox-precache-v2-x']);
    expect(idb).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
