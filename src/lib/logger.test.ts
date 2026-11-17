// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from 'vitest';

const setUserMock = vi.fn();
const setTagMock = vi.fn();
vi.mock('@sentry/react', () => ({
  setUser: (...args: any[]) => setUserMock(...args),
  setTag: (...args: any[]) => setTagMock(...args),
  init: vi.fn(),
  browserTracingIntegration: vi.fn(),
  withScope: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  setUserMock.mockReset();
  setTagMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test('setLoggerUserContext is a no-op without a configured DSN', async () => {
  vi.stubEnv('VITE_SENTRY_DSN', '');
  vi.stubEnv('PROD', true);
  const { setLoggerUserContext } = await import('./logger');

  setLoggerUserContext({ uid: 'staff-1', tenantId: 'tenant-1', role: 'cashier' });

  expect(setUserMock).not.toHaveBeenCalled();
  expect(setTagMock).not.toHaveBeenCalled();
});

test('setLoggerUserContext is a no-op outside production, even with a DSN set', async () => {
  vi.stubEnv('VITE_SENTRY_DSN', 'https://example.ingest.sentry.io/1');
  vi.stubEnv('PROD', false);
  const { setLoggerUserContext } = await import('./logger');

  setLoggerUserContext({ uid: 'staff-1', tenantId: 'tenant-1', role: 'cashier' });

  expect(setUserMock).not.toHaveBeenCalled();
  expect(setTagMock).not.toHaveBeenCalled();
});

test('setLoggerUserContext tags every captured event with tenant/role/branch once identity resolves', async () => {
  vi.stubEnv('VITE_SENTRY_DSN', 'https://example.ingest.sentry.io/1');
  vi.stubEnv('PROD', true);
  const { setLoggerUserContext } = await import('./logger');

  setLoggerUserContext({ uid: 'staff-1', tenantId: 'tenant-1', role: 'cashier', branchId: 'branch-1' });

  expect(setUserMock).toHaveBeenCalledWith({ id: 'staff-1' });
  expect(setTagMock).toHaveBeenCalledWith('tenant_id', 'tenant-1');
  expect(setTagMock).toHaveBeenCalledWith('role', 'cashier');
  expect(setTagMock).toHaveBeenCalledWith('branch_id', 'branch-1');
});

test('setLoggerUserContext clears identity on logout (null) instead of leaving the previous user tagged', async () => {
  vi.stubEnv('VITE_SENTRY_DSN', 'https://example.ingest.sentry.io/1');
  vi.stubEnv('PROD', true);
  const { setLoggerUserContext } = await import('./logger');

  setLoggerUserContext({ uid: 'staff-1', tenantId: 'tenant-1', role: 'cashier' });
  setUserMock.mockClear();
  setTagMock.mockClear();

  setLoggerUserContext(null);

  expect(setUserMock).toHaveBeenCalledWith(null);
  expect(setTagMock).toHaveBeenCalledWith('tenant_id', null);
  expect(setTagMock).toHaveBeenCalledWith('role', null);
  expect(setTagMock).toHaveBeenCalledWith('branch_id', null);
});
