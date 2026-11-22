/**
 * Error helpers shared by ~35 files (seen-performance-first-open-login-task.md
 * Phase 2): moved out of lib/firebase.ts, which also initializes the Firebase
 * SDK -- importing these from there pulled the whole SDK (~86KB) into the
 * startup bundle for every user, though Firebase is only used for push
 * notifications. Nothing here touches Firebase.
 */
import i18n from 'i18next';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  }
}

// Supabase Auth has no synchronous "current user" accessor (unlike Firebase's
// auth.currentUser), so AuthContext pushes the current session's identity
// here on every auth-state change, keeping this function's synchronous
// signature intact for its ~30 call sites.
let currentSessionInfo: { userId?: string | null; email?: string | null } = {};
export function setCurrentAuthSessionInfo(info: { userId?: string | null; email?: string | null }) {
  currentSessionInfo = info;
}

export function handleFirestoreError(error: any, operationType: OperationType, path: string | null) {
  let errorString = 'Unknown Error';

  try {
    if (error instanceof Error) {
      errorString = error.message;
    } else if (typeof error === 'string') {
      errorString = error;
    } else {
      errorString = JSON.stringify(error);
    }
  } catch (e) {
    errorString = String(error);
  }

  const errInfo: FirestoreErrorInfo = {
    error: errorString,
    authInfo: {
      userId: currentSessionInfo.userId,
      email: currentSessionInfo.email,
    },
    operationType,
    path
  };

  console.warn(`[Firestore Error] ${operationType} at ${path}:`, errInfo);

  let serializedErr: string;
  try {
    serializedErr = JSON.stringify(errInfo);
  } catch (e) {
    console.warn("Failed to stringify error info:", e);
    serializedErr = `Firestore Error in ${operationType} at ${path}: ${errorString}`;
  }
  const thrown = new Error(serializedErr);
  // seen-readiness-fixes-task.md P4 (UX-01): a failed save, status change or
  // delete was rethrown here and then swallowed by the global rejection
  // handler -- the employee saw nothing. A failed write now reaches the toast
  // stack (ToastProvider listens); a failed background read stays quiet.
  if (WRITE_OPERATIONS.has(operationType) && typeof window !== 'undefined') {
    (thrown as any).__shownToUser = true;
    window.dispatchEvent(new CustomEvent<FirestoreErrorInfo>(APP_WRITE_ERROR_EVENT, { detail: errInfo }));
  }
  throw thrown;
}

/** P4 (UX-01): fired on window when a user's write failed; ToastProvider shows it. */
export const APP_WRITE_ERROR_EVENT = 'seen-app-write-error';
const WRITE_OPERATIONS = new Set<OperationType>([OperationType.CREATE, OperationType.UPDATE, OperationType.DELETE, OperationType.WRITE]);

// Alias for backward compatibility while migrating
export const handleError = handleFirestoreError;

export const getFriendlyErrorMessage = (error: any): string => {
  if (!error) return i18n.t('errors.unknown');
  // P4: the server's own refusal (in Arabic, with its reason) says more than
  // any generic message -- e.g. "لا يُحذف عميل له طلبات مفتوحة".
  const refusal = dbRefusalMessage(error);
  if (refusal) return refusal;

  const errorMsg = typeof error === 'string' ? error : (error.error || error.message || '');
  const code = error.code || '';

  if (code === 'auth/user-not-found' || code === 'auth/wrong-password') return i18n.t('login.errors.invalid_credentials');
  if (errorMsg.toLowerCase().includes('jwt expired') || errorMsg.includes('PGRST303') || errorMsg.toLowerCase().includes('token expired') || errorMsg.toLowerCase().includes('token_expired')) {
    return i18n.t('errors.jwt_expired');
  }
  if (code === 'auth/permission-denied' || code === 'permission-denied' || errorMsg.toLowerCase().includes('permission-denied') || errorMsg.includes('insufficient permissions')) {
    return i18n.t('errors.permission_denied_check_account');
  }
  if (errorMsg.toLowerCase().includes('offline') || errorMsg.toLowerCase().includes('network') || errorMsg.toLowerCase().includes('fetch')) {
    return i18n.t('errors.server_connection_failed');
  }
  if (errorMsg.toLowerCase().includes('quota-exceeded')) {
    return i18n.t('errors.daily_quota_exceeded');
  }
  // seen-error-messages-task.md: project-specific Postgres/Supabase errors
  // that used to fall through to the raw technical string (if short enough)
  // or a fully generic message -- these are common enough in this app
  // (every RLS-protected table, every unique constraint) to deserve their
  // own real Arabic message instead of either.
  if (errorMsg.toLowerCase().includes('row-level security policy') || code === '42501') {
    return i18n.t('errors.rls_denied');
  }
  if (errorMsg.toLowerCase().includes('duplicate key value violates unique constraint') || code === '23505') {
    return i18n.t('errors.duplicate_entry');
  }
  if (errorMsg.toLowerCase().includes('zatca')) {
    return i18n.t('errors.zatca_submission_failed');
  }

  const finalMsg = errorMsg && errorMsg.length < 100 ? `${errorMsg}` : i18n.t('errors.system_generic');
  return finalMsg;
};

/**
 * seen-readiness-fixes-task.md P1.3: the server refuses some actions on purpose
 * and says why in the shop's language ("open a shift before taking a
 * payment", "no payment on a cancelled order", "more than what is left").
 * Those messages are for the employee as they are; anything else is not.
 */
export function dbRefusalMessage(error: unknown): string | null {
  const e = error as { code?: string; message?: string } | null;
  if (!e || typeof e.message !== 'string') return null;
  if (!['22023', '23514', '42501'].includes(String(e.code ?? ''))) return null;
  if (e.message === 'forbidden' || !/[\u0600-\u06FF]/.test(e.message)) return null;
  return e.message;
}
