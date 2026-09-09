import i18n from 'i18next';
import * as Sentry from '@sentry/react';
import { OperationType } from './firebase';

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

export const logError = (error: any, context?: any) => {
  if (!error) return;

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
  
  if (errorMsg === '{}' || !errorMsg) return;

  let ctxStr = '';
  if (context) {
    try { ctxStr = JSON.stringify(context); } catch (e) {}
  }
  console.warn('[Logger] Error:', errorMsg, ctxStr);

  if (import.meta.env.VITE_SENTRY_DSN && import.meta.env.PROD) {
    Sentry.withScope((scope) => {
      if (context) {
        Object.keys(context).forEach(key => {
          scope.setExtra(key, context[key]);
        });
      }
      Sentry.captureException(error instanceof Error ? error : new Error(String(errorMsg)));
    });
  }
};

export const logMessage = (message: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info') => {
  console[level](`[Logger: ${level.toUpperCase()}] ${message}`);

  if (import.meta.env.VITE_SENTRY_DSN && import.meta.env.PROD) {
    Sentry.captureMessage(message, level === 'warn' ? 'warning' : level);
  }
};

export const getFriendlyErrorMessage = (error: any): string => {
  if (!error) return i18n.t('errors.unknown');
  const code = error.code || '';
  if (code === 'auth/user-not-found' || code === 'auth/wrong-password') return i18n.t('login.errors.invalid_credentials');
  if (code === 'auth/permission-denied' || code === 'permission-denied') return i18n.t('errors.no_permission');
  return i18n.t('errors.generic_retry');
};
