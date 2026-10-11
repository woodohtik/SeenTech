import * as Sentry from '@sentry/node';

/**
 * seen-launch-readiness-report.md #8: Sentry was wired for the browser only
 * (@sentry/react, src/lib/logger.ts) -- every server.ts error, including
 * the silent PIH chain-advance failure this same report flagged as #2,
 * only ever reached Vercel's own scattered function logs, with no alert to
 * anyone. Mirrors the client logger's own pattern: a safe no-op until a DSN
 * is actually set, so nothing breaks for anyone who hasn't configured one.
 */
export function initServerLogger(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
}

export function captureServerException(error: unknown, context?: Record<string, unknown>): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        scope.setExtra(key, value);
      }
    }
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
}
