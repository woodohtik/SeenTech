/**
 * Error helpers shared by ~35 files (seen-performance-first-open-login-task.md
 * Phase 2): moved out of lib/firebase.ts, which also initializes the Firebase
 * SDK -- importing these from there pulled the whole SDK (~86KB) into the
 * startup bundle for every user, though Firebase is only used for push
 * notifications. Nothing here touches Firebase.
 */
import { dbRefusalMessage, toUserError } from './userFacingError';

export { dbRefusalMessage };

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

/**
 * The one line a person sees for an error (seen-friendly-errors-everywhere-task.md):
 * toUserError's title and action. Never the error's own text.
 */
export const getFriendlyErrorMessage = (error: unknown): string => toUserError(error).message;
