// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hardRecover = vi.fn().mockResolvedValue(undefined);
vi.mock('./chunkRecovery', () => ({ hardRecover: () => hardRecover() }));

import { registerUnsavedWork, notifyWorkSettled } from './unsavedWork';
import {
  APPLY_RECORD_KEY,
  HARD_RECORD_KEY,
  __resetUpdateManagerForTests,
  applyUpdateNow,
  getUpdateStatus,
  reportUpdate,
} from './updateManager';

// seen-update-delivery-fix-task.md, phase 3: an update applies by itself on
// a safe screen, waits for the sale or the save otherwise, and never loops.

const reload = vi.fn();
const cleanups: (() => void)[] = [];

function stubWorker(opts: { waiting?: boolean; takesOver?: boolean } = {}) {
  const listeners: Record<string, (() => void)[]> = {};
  const postMessage = vi.fn(() => {
    if (opts.takesOver !== false) (listeners.controllerchange || []).forEach((fn) => fn());
  });
  const registration = { update: vi.fn().mockResolvedValue(undefined), waiting: opts.waiting === false ? null : { postMessage }, installing: null, addEventListener: vi.fn() };
  vi.stubGlobal('navigator', {
    ...navigator,
    serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue(registration),
      addEventListener: (name: string, fn: () => void) => { (listeners[name] ||= []).push(fn); },
      removeEventListener: vi.fn(),
    },
  });
  return { registration, postMessage };
}

beforeEach(() => {
  sessionStorage.clear();
  reload.mockReset();
  hardRecover.mockClear();
  __resetUpdateManagerForTests('b1');
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } });
});
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('reportUpdate', () => {
  it('on a safe screen applies at once: new worker takes over, then one reload', async () => {
    const { postMessage } = stubWorker();
    reportUpdate({ build: 'b2' });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('with a cart in progress it waits, then applies right after the sale', async () => {
    stubWorker();
    let cart = 3;
    cleanups.push(registerUnsavedWork('pos-cart', () => cart > 0));
    reportUpdate({ build: 'b2' });
    await Promise.resolve();
    expect(getUpdateStatus()).toBe('waiting-for-safe');
    expect(reload).not.toHaveBeenCalled();
    cart = 0;
    notifyWorkSettled();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('a mandatory update over unsaved work shows the full screen instead of reloading', async () => {
    stubWorker();
    cleanups.push(registerUnsavedWork('form', () => true));
    reportUpdate({ build: 'b2', mandatory: true });
    await Promise.resolve();
    expect(getUpdateStatus()).toBe('mandatory');
    expect(reload).not.toHaveBeenCalled();
  });

  it('a mandatory update on a safe screen just applies', async () => {
    stubWorker();
    reportUpdate({ build: 'b2', mandatory: true });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});

describe('applyUpdateNow', () => {
  it('reloads even when no worker is waiting (the page itself is from the network)', async () => {
    stubWorker({ waiting: false });
    await applyUpdateNow();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(hardRecover).not.toHaveBeenCalled();
  });

  it('a worker that never takes over: after 30 seconds, the hard way', async () => {
    vi.useFakeTimers();
    stubWorker({ takesOver: false });
    const done = applyUpdateNow();
    await vi.advanceTimersByTimeAsync(31_000);
    await done;
    expect(hardRecover).toHaveBeenCalledTimes(1);
  });

  it('back on the same old build within 2 minutes of an apply: the hard way once, then it stops', async () => {
    stubWorker();
    sessionStorage.setItem(APPLY_RECORD_KEY, JSON.stringify({ from: 'b1', at: Date.now() - 30_000 }));
    await applyUpdateNow();
    expect(hardRecover).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();

    // Still the same build after the hard way too: no more automatic tries.
    __resetUpdateManagerForTests('b1');
    expect(sessionStorage.getItem(HARD_RECORD_KEY)).not.toBeNull();
    await applyUpdateNow();
    expect(hardRecover).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(getUpdateStatus()).toBe('stuck');
  });
});
