import * as Sentry from '@sentry/node';
import pino from 'pino';

// seen-structured-logging-task.md: 44 console.*/server.ts+src/server/*.ts
// call sites, no structured logging at all before this. Paths below are
// pino's redact syntax (JSON-path with wildcards) -- they only scrub
// fields passed as part of a structured mergingObject (logger.info({...},
// 'msg')), never the free-text msg string itself. Every call site that
// might carry one of these fields MUST pass it inside a structured object
// (never string-interpolated) for this to actually protect it -- this is
// exactly why seen-structured-logging-task.md calls for a manual pass over
// each site rather than a blind find-replace.
const SENSITIVE_PATHS = [
  // staff PIN (plaintext by deliberate product decision, see authMiddleware.ts --
  // still must never reach a log line)
  'pin', 'pinHash', 'pin_hash', '*.pin', '*.pinHash', '*.pin_hash',
  // ZATCA credentials -- encrypted at rest, but no reason to ever log them either
  'privateKeyPem', 'private_key_encrypted', '*.private_key_encrypted',
  // Firebase service account private key (firebase-admin.ts)
  'private_key', '*.private_key', 'serviceAccount', '*.serviceAccount',
  'secret', 'secret_encrypted', '*.secret_encrypted',
  'certificate', '*.certificate',
  // AI assistant provider keys
  'apiKey', 'api_key_encrypted', '*.api_key_encrypted',
  // full phone numbers (customers and staff)
  'phone', '*.phone', 'customer_phone', '*.customer_phone',
  // print-agent pairing (printRelay.ts: pair_code/pairCode, client_token)
  'pair_code', 'pairCode', '*.pair_code', '*.pairCode',
  'client_token', '*.client_token',
  // any raw bearer/JWT that might get logged while debugging auth
  'authorization', 'req.headers.authorization',
];

const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

export const logger = pino({
  level: isProd ? 'info' : 'debug',
  redact: { paths: SENSITIVE_PATHS, censor: '[REDACTED]' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

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
