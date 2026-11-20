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

export const app = finalConfig.apiKey ? initializeApp(finalConfig) : null;

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

// The error helpers that used to live here (getFriendlyErrorMessage,
// handleFirestoreError, OperationType, ...) are in ./appErrors, so that
// importing them no longer loads this SDK. Import from there.
