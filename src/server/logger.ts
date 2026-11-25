import pino from 'pino';
import { IGNORED_ERRORS, scrubBreadcrumb, scrubEvent, sentryEnvironment } from '../lib/sentryScrub';

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
//
// seen-performance-first-open-login-task.md Phase 7: @sentry/node took
// about half of the server's start-up (cold start before the first
// request, e.g. the phone-number login lookup). It is now loaded right
// after start, without holding it up; errors reported before it finishes
// loading wait for it and are still sent. Only Sentry's automatic request
// tracing (10% sampling) is lost, since that needs Sentry loaded before
// express -- error reporting is unchanged.
let sentryLoad: Promise<typeof import('@sentry/node')> | null = null;
function loadSentry() {
  if (!sentryLoad) sentryLoad = import('@sentry/node');
  return sentryLoad;
}

export function initServerLogger(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  void loadSentry()
    .then((Sentry) => {
      // seen-sentry-setup-task.md: the browser's release (the commit) and
      // environment (production / staging); PDPL -- technical data only,
      // every event through sentryScrub.ts, no default PII (no IP, no
      // request body, cookies or headers), no Sentry Logs; tracing 5% in
      // production (question 4).
      const environment = sentryEnvironment(process.env.VERCEL_ENV, process.env.NODE_ENV);
      Sentry.init({
        dsn,
        release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
        environment,
        tracesSampleRate: environment === 'production' ? 0.05 : 1.0,
        sendDefaultPii: false,
        enableLogs: false,
        ignoreErrors: IGNORED_ERRORS,
        beforeSend: (event) => scrubEvent(event),
        beforeSendTransaction: (event) => scrubEvent(event),
        beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
        initialScope: { tags: { app: 'server' } },
      });
    })
    .catch((err) => logger.error({ err }, '[sentry] failed to load'));
}

// seen-cto-sprint4-design-quality-task.md item 1: the two call sites that
// already passed tenantId (server.ts:2297, 2521) only reached Sentry as an
// unindexed extra -- not filterable by tenant in the Sentry UI, same gap
// the client logger had. The server has no persistent per-request session
// to hook a single setUser() into like AuthContext.tsx does for the
// browser, so this promotes whichever of these identifying fields a call
// site happens to pass into real tags, without requiring every one of the
// 7 call sites to change.
const TAG_KEYS = ['tenantId', 'orderId', 'invoiceId'] as const;

/**
 * Sends an error to Sentry. seen-sentry-setup-task.md 4: a Vercel Function
 * stops right after its reply, so a "fire and forget" send could be lost --
 * the send and a short flush are handed to waitUntil, which keeps the
 * Function alive for them after the reply. Resolves to the event id (or
 * undefined), for the super admin's test route.
 */
export function captureServerException(error: unknown, context?: Record<string, unknown>): Promise<string | undefined> {
  if (!process.env.SENTRY_DSN) return Promise.resolve(undefined);
  const sending = loadSentry().then(async (Sentry) => {
    let eventId: string | undefined;
    Sentry.withScope((scope) => {
      if (context) {
        for (const [key, value] of Object.entries(context)) {
          if ((TAG_KEYS as readonly string[]).includes(key) && value != null) {
            scope.setTag(key, String(value));
          }
          scope.setExtra(key, value);
        }
      }
      eventId = Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
    });
    await Sentry.flush(2000);
    return eventId;
  }).catch(() => undefined /* reported to the log by the call site already */);
  keepAliveUntil(sending);
  return sending;
}

/** Vercel's waitUntil when running there; elsewhere the promise simply runs on. */
function keepAliveUntil(promise: Promise<unknown>): void {
  void import('@vercel/functions')
    .then(({ waitUntil }) => waitUntil(promise))
    .catch(() => { /* not on Vercel (local / tests) */ });
}
