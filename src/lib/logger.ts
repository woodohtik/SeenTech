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
  // Console logging for development
  console.error('[Logger] Error:', error, context);

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
  if (!error) return 'حدث خطأ غير معروف';
  const code = error.code || '';
  if (code === 'auth/user-not-found' || code === 'auth/wrong-password') return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  if (code === 'auth/permission-denied' || code === 'permission-denied') return 'ليس لديك صلاحية للقيام بهذا الإجراء';
  return 'حدث خطأ. يرجى المحاولة مرة أخرى.';
};
