import * as Sentry from '@sentry/react';
import { DENIED_URLS, IGNORED_ERRORS, STALE_BUILD_ERROR, scrubBreadcrumb, scrubEvent } from './sentryScrub';

// Set by scripts/vite-build-id.ts (the main app's build); absent in the customer app's.
declare const __SENTRY_RELEASE__: string | undefined;
declare const __SENTRY_ENVIRONMENT__: string | undefined;

/**
 * Sentry activates only once VITE_SENTRY_DSN is actually set (Vercel env
 * var / local .env) -- no DSN means Sentry.init() is simply never called.
 * Call this once from main.tsx (and main-customer.tsx) before rendering.
 *
 * seen-sentry-setup-task.md:
 *  - release (the commit) and environment (production / staging), so an
 *    error says which build and which site it came from;
 *  - PDPL (section 7): technical data only -- every event and breadcrumb
 *    goes through sentryScrub.ts; no default PII, no IP, no Session Replay,
 *    no User Feedback, no Sentry Logs;
 *  - tracing 5% in production (question 4), all of it elsewhere; errors 100%;
 *  - noise (ResizeObserver, extensions, aborted requests) left out.
 */
export const initLogger = (app: 'web' | 'customer' = 'web') => {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || !import.meta.env.PROD) return;
  const environment = typeof __SENTRY_ENVIRONMENT__ !== 'undefined' && __SENTRY_ENVIRONMENT__ ? __SENTRY_ENVIRONMENT__ : 'production';
  Sentry.init({
    dsn,
    release: typeof __SENTRY_RELEASE__ !== 'undefined' && __SENTRY_RELEASE__ ? __SENTRY_RELEASE__ : undefined,
    environment,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: environment === 'production' ? 0.05 : 1.0,
    sendDefaultPii: false,
    enableLogs: false,
    ignoreErrors: IGNORED_ERRORS,
    denyUrls: DENIED_URLS,
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    initialScope: { tags: { app } },
  });
};

/**
 * seen-cto-sprint4-design-quality-task.md item 1 (CTO review section
 * 6/9): Sentry was wired up but carried no tenant/user context at all --
 * every captured error arrived anonymous, so diagnosing a production
 * incident meant guessing which merchant it came from from raw logs.
 * Call this once identity resolves (AuthContext.tsx, after
 * resolveIdentity), and again with null on logout, so every event from
 * here on is scoped the same way without every call site passing its
 * own context by hand.
 */
export const setLoggerUserContext = (user: {
  uid: string;
  tenantId: string | null;
  role: string | null;
  branchId?: string | null;
} | null) => {
  if (!import.meta.env.VITE_SENTRY_DSN || !import.meta.env.PROD) return;
  if (!user) {
    Sentry.setUser(null);
    Sentry.setTag('tenant_id', null);
    Sentry.setTag('role', null);
    Sentry.setTag('branch_id', null);
    return;
  }
  Sentry.setUser({ id: user.uid });
  Sentry.setTag('tenant_id', user.tenantId);
  Sentry.setTag('role', user.role);
  if (user.branchId) Sentry.setTag('branch_id', user.branchId);
};

/** Logs an error; returns the Sentry event id when Sentry is on. */
export const logError = (error: any, context?: any): string | undefined => {
  if (!error) return undefined;

  console.warn('[Logger] RAW ERROR:', error);
  if (context) {
    console.warn('[Logger] CONTEXT:', context);
  }

  // Console logging for development
  let errorMsg = error;
  if (error instanceof Error) {
    errorMsg = error.stack || error.message;
  } else if (typeof error === 'object') {
    try { 
      errorMsg = JSON.stringify(error); 
      if (errorMsg === '{}') {
        errorMsg = error.message || error.type || String(error);
      }
    } catch (e) {}
  }
  
  if (errorMsg === '{}' || !errorMsg) return undefined;

  let ctxStr = '';
  if (context) {
    try { ctxStr = JSON.stringify(context); } catch (e) {}
  }
  console.warn('[Logger] Error:', errorMsg, ctxStr);

  if (import.meta.env.VITE_SENTRY_DSN && import.meta.env.PROD) {
    let eventId: string | undefined;
    Sentry.withScope((scope) => {
      if (context) {
        Object.keys(context).forEach(key => {
          scope.setExtra(key, context[key]);
        });
        // seen-sentry-setup-task.md 6: the code the shop sees (NET-01, SAVE-02...)
        // is a tag, so the support team finds the event by it.
        if (typeof context.error_code === 'string') scope.setTag('user_code', context.error_code);
        if (typeof context.auth_error_code === 'string') scope.setTag('user_code', context.auth_error_code);
      }
      // A code chunk missing after an update (ErrorBoundary recovers): a warning.
      const text = error instanceof Error ? `${error.name}: ${error.message}` : String(errorMsg);
      if (STALE_BUILD_ERROR.test(text)) {
        scope.setLevel('warning');
        scope.setTag('stale_build', 'true');
      }
      eventId = Sentry.captureException(error instanceof Error ? error : new Error(String(errorMsg)));
    });
    return eventId;
  }
  return undefined;
};

export const logMessage = (message: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info') => {
  console[level](`[Logger: ${level.toUpperCase()}] ${message}`);

  if (import.meta.env.VITE_SENTRY_DSN && import.meta.env.PROD) {
    Sentry.captureMessage(message, level === 'warn' ? 'warning' : level);
  }
};
