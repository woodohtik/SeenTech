// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from 'vitest';

const registerSWMock = vi.fn();
vi.mock('virtual:pwa-register', () => ({
  registerSW: (...args: any[]) => registerSWMock(...args),
}));

function makeRegistration() {
  return { update: vi.fn().mockResolvedValue(undefined) };
}

beforeEach(() => {
  vi.resetModules();
  registerSWMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup() {
  const mod = await import('./pwaUpdate');
  const registration = makeRegistration();
  mod.initPwaUpdates();
  const options = registerSWMock.mock.calls[0][0];
  options.onRegisteredSW('/sw.js', registration);
  // Registration itself fires an immediate check (tested on its own below)
  // and starts the 60s debounce window from that moment. Clear the call and
  // advance past that window so every other test below measures only its
  // own trigger's marginal effect, not the baseline call or its debounce.
  registration.update.mockClear();
  vi.advanceTimersByTime(61_000);
  return { mod, registration, options };
}

test('checks for an update immediately once registration succeeds', async () => {
  const mod = await import('./pwaUpdate');
  const registration = makeRegistration();
  mod.initPwaUpdates();
  const options = registerSWMock.mock.calls[0][0];
  options.onRegisteredSW('/sw.js', registration);
  expect(registration.update).toHaveBeenCalledTimes(1);
});

test('checks for an update when the tab becomes visible again', async () => {
  const { registration } = await setup();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(registration.update).toHaveBeenCalledTimes(1);
});

test('does not check when visibilitychange fires but the tab is hidden', async () => {
  const { registration } = await setup();
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(registration.update).not.toHaveBeenCalled();
});

test('checks for an update on window focus', async () => {
  const { registration } = await setup();
  window.dispatchEvent(new Event('focus'));
  expect(registration.update).toHaveBeenCalledTimes(1);
});

test('checks for an update when the device comes back online', async () => {
  const { registration } = await setup();
  window.dispatchEvent(new Event('online'));
  expect(registration.update).toHaveBeenCalledTimes(1);
});

test('debounces rapid repeated checks within 60 seconds', async () => {
  const { registration } = await setup();
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  window.dispatchEvent(new Event('focus'));
  expect(registration.update).toHaveBeenCalledTimes(1);
});

test('checks again after the debounce window has passed', async () => {
  const { registration } = await setup();
  window.dispatchEvent(new Event('focus'));
  expect(registration.update).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(61_000);
  window.dispatchEvent(new Event('focus'));
  expect(registration.update).toHaveBeenCalledTimes(2);
});

test('the hourly safety-net interval still calls update', async () => {
  const { registration } = await setup();
  vi.advanceTimersByTime(60 * 60 * 1000);
  expect(registration.update).toHaveBeenCalledTimes(1);
});

test('none of the new automatic checks ever call applyPendingUpdate (no auto-reload)', async () => {
  const { mod, registration } = await setup();
  const applySpy = vi.spyOn(mod, 'applyPendingUpdate');
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(registration.update).toHaveBeenCalled();
  expect(applySpy).not.toHaveBeenCalled();
});
