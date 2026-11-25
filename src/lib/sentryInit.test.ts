// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// seen-sentry-setup-task.md section 7 (PDPL): the canary through what each
// side really passes to Sentry.init -- the browser (src/lib/logger.ts) and
// the server (src/server/logger.ts).
const browserInit = vi.fn();
vi.mock('@sentry/react', () => ({
  init: (o: unknown) => browserInit(o),
  browserTracingIntegration: () => ({ name: 'BrowserTracing' }),
  withScope: vi.fn(), captureException: vi.fn(), setUser: vi.fn(), setTag: vi.fn(), captureMessage: vi.fn(),
}));
const serverInit = vi.fn();
vi.mock('@sentry/node', () => ({ init: (o: unknown) => serverInit(o), withScope: vi.fn(), captureException: vi.fn(), flush: vi.fn() }));

const CANARIES = ['0501234567', 'abdullah.ali@example.com', 'عبدالله علي', '7f3a9c2e5b8d4e1fa2c3', '300000000000003', '85.12.4.200', 'كتف 48'];
const canary = () => ({
  message: 'failed for 0501234567',
  exception: { values: [{ value: 'Key (phone)=(0501234567) already exists' }] },
  request: { url: '/track/7f3a9c2e5b8d4e1fa2c3', data: { name: 'عبدالله علي' }, headers: { 'x-forwarded-for': '85.12.4.200' } },
  user: { id: 'u1', email: 'abdullah.ali@example.com', ip_address: '85.12.4.200' },
  extra: { buyerTrn: '300000000000003', measurements: { shoulder: 'كتف 48' } },
  breadcrumbs: [{ category: 'console', message: 'abdullah.ali@example.com' }],
});

afterEach(() => { vi.unstubAllEnvs(); browserInit.mockReset(); serverInit.mockReset(); });

describe('Sentry as each side starts it', () => {
  it('the browser: technical data only, no PII, no replay, 5% tracing in production', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@o1.ingest.de.sentry.io/1');
    vi.stubEnv('PROD', true);
    const { initLogger } = await import('./logger');
    initLogger();
    const o = browserInit.mock.calls[0][0];
    expect(o).toMatchObject({ sendDefaultPii: false, enableLogs: false, tracesSampleRate: 0.05, environment: 'production' });
    expect(o.integrations.map((i: any) => i.name)).toEqual(['BrowserTracing']);
    const sent = JSON.stringify(o.beforeSend(canary()));
    for (const value of CANARIES) expect(sent, value).not.toContain(value);
    expect(o.beforeBreadcrumb({ category: 'console', message: 'x' })).toBeNull();
  });

  it('the server: the same cleaning, staging named as staging', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://public@o1.ingest.de.sentry.io/2');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc1234def');
    const { initServerLogger } = await import('../server/logger');
    initServerLogger();
    await vi.waitFor(() => expect(serverInit).toHaveBeenCalled());
    const o = serverInit.mock.calls[0][0];
    expect(o).toMatchObject({ sendDefaultPii: false, enableLogs: false, environment: 'staging', release: 'abc1234def' });
    const sent = JSON.stringify(o.beforeSend(canary()));
    for (const value of CANARIES) expect(sent, value).not.toContain(value);
  });
});
