import i18n from 'i18next';
import { OperationType } from './firebase';

/**
 * 
 * ==============================================================
 * 🚀 CENTRALIZED ERROR LOGGING (SENTRY / CRASHLYTICS)
 * ==============================================================
 * 
 * To implement a robust error tracking system like Sentry, 
 * follow these steps:
 * 
 * 1. Install Sentry: `npm install @sentry/react @sentry/tracing`
 * 2. Uncomment the initialization code below and add your DSN.
 * 3. Replace simple `console.error` calls with `Sentry.captureException`.
 * 4. Optionally, you can use Firebase Crashlytics on the web by logging 
 *    issues into a specific Firestore collection, but Sentry is the industry
 *    standard for React Web Apps.
 */

// import * as Sentry from '@sentry/react';
// import { BrowserTracing } from '@sentry/tracing';

// export const initLogger = () => {
//   if (import.meta.env.PROD) {
//     Sentry.init({
//       dsn: "YOUR_SENTRY_DSN_HERE",
//       integrations: [new BrowserTracing()],
//       tracesSampleRate: 1.0,
//     });
//   }
// };

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


  // Example Sentry integration:
  // if (import.meta.env.PROD) {
  //   Sentry.withScope((scope) => {
  //     if (context) {
  //       Object.keys(context).forEach(key => {
  //         scope.setExtra(key, context[key]);
  //       });
  //     }
  //     Sentry.captureException(error);
  //   });
  // }
};

export const logMessage = (message: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info') => {
  console[level](`[Logger: ${level.toUpperCase()}] ${message}`);
  
  // Example Sentry integration:
  // if (import.meta.env.PROD) {
  //   Sentry.captureMessage(message, level as Sentry.SeverityLevel);
  // }
};

export const getFriendlyErrorMessage = (error: any): string => {
  if (!error) return i18n.t('errors.unknown');
  const code = error.code || '';
  if (code === 'auth/user-not-found' || code === 'auth/wrong-password') return i18n.t('login.errors.invalid_credentials');
  if (code === 'auth/permission-denied' || code === 'permission-denied') return i18n.t('errors.no_permission');
  return i18n.t('errors.generic_retry');
};
