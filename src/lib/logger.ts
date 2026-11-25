import * as Sentry from '@sentry/react';

/**
 * Sentry activates only once VITE_SENTRY_DSN is actually set (Vercel env
 * var / local .env) -- no DSN means Sentry.init() is simply never called,
 * so this stays a safe no-op until the user creates a Sentry project and
 * sets the var (seen-master-backlog-and-structure.md P3: Sentry not
 * installed). Call this once from main.tsx before rendering.
 */
export const initLogger = () => {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || !import.meta.env.PROD) return;
  Sentry.init({
    dsn,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.2,
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
