import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  initializeAuth,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver
} from 'firebase/auth';

export const finalConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim() || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim() || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim() || '',
};

const app = finalConfig.apiKey ? initializeApp(finalConfig) : null;

// Fix for Iframe/Preview blocking: attempt graceful degradation of persistence
let auth: ReturnType<typeof getAuth> | null = null;
if (app) {
  try {
    auth = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch (error) {
    console.warn("initializeAuth failed (likely due to strict iframe blocking), falling back to simple getAuth:", error);
    auth = getAuth(app);
  }
}

export { auth };
export const db = null as any;
export const storage = null as any;
// NOTE (Stage 1 migration): Firestore (db) and Firebase Storage (storage)
// exports have been removed. Data lives in Supabase (src/types/lib/supabase/client.ts)
// and new image uploads go through Supabase Storage (src/types/lib/supabase/storage.ts).
// Firebase here is for AUTH ONLY (Stage 2 will migrate auth + RLS).

if (!auth) {
  console.error("[CRITICAL] Firebase Auth failed to initialize. Check environment variables.");
}

// Authentication Logic ONLY - No Databases allowed here as per System Architect rules

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
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
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
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
    },
    operationType,
    path
  };

  console.error(`[Firestore Error] ${operationType} at ${path}:`, errInfo);

  let serializedErr: string;
  try {
    serializedErr = JSON.stringify(errInfo);
  } catch (e) {
    console.error("Failed to stringify error info:", e);
    serializedErr = `Firestore Error in ${operationType} at ${path}: ${errorString}`;
  }
  throw new Error(serializedErr);
}

// Alias for backward compatibility while migrating
export const handleError = handleFirestoreError;

export const getFriendlyErrorMessage = (error: any): string => {
  if (!error) return 'حدث خطأ غير معروف';

  const errorMsg = typeof error === 'string' ? error : (error.error || error.message || '');
  const code = error.code || '';

  if (code === 'auth/user-not-found' || code === 'auth/wrong-password') return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  if (code === 'auth/permission-denied' || code === 'permission-denied' || errorMsg.toLowerCase().includes('permission-denied') || errorMsg.includes('insufficient permissions')) {
    return 'ليس لديك صلاحية للقيام بهذا الإجراء. يرجى التأكد من صلاحيات حسابك.';
  }
  if (errorMsg.toLowerCase().includes('offline') || errorMsg.toLowerCase().includes('network') || errorMsg.toLowerCase().includes('fetch')) {
    return 'فشل الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت وحاول مرة أخرى.';
  }
  if (errorMsg.toLowerCase().includes('quota-exceeded')) {
    return 'لقد تجاوزت حصة الاستخدام المسموح بها لهذا اليوم. يرجى المحاولة غداً.';
  }

  const finalMsg = errorMsg && errorMsg.length < 100 ? `${errorMsg}` : 'حدث خطأ في النظام. يرجى المحاولة مرة أخرى لاحقاً.';
  return finalMsg;
};
