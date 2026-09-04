import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

if (!admin.apps.length) {
  try {
    const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (serviceAccountVar) {
      let serviceAccount;
      if (serviceAccountVar.startsWith('{')) {
        serviceAccount = JSON.parse(serviceAccountVar);
      } else {
        // Handle base64 encoded service account if provided
        try {
          serviceAccount = JSON.parse(Buffer.from(serviceAccountVar, 'base64').toString());
        } catch (e) {
          console.error('FIREBASE_SERVICE_ACCOUNT is neither valid JSON nor valid Base64 JSON.');
        }
      }

      if (serviceAccount) {
        // Fix for private key newlines in environment variables
        if (serviceAccount.private_key && typeof serviceAccount.private_key === 'string') {
          serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }

        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: process.env.VITE_FIREBASE_DATABASE_URL || `https://${serviceAccount.project_id}.firebaseio.com`
        });
        console.log('[DEBUG] Firebase Admin initialized with service account.');
      }
    } else if (process.env.VITE_FIREBASE_PROJECT_ID) {
        // Fallback to minimal initialization (useful for client-side matching roles)
        admin.initializeApp({
          projectId: process.env.VITE_FIREBASE_PROJECT_ID
        });
        console.log('[DEBUG] Firebase Admin initialized with Project ID only.');
    } else {
        console.warn('No Firebase Admin credentials provided. Attempting default initialization...');
        admin.initializeApp();
    }
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
  }
}

export const adminAuth = admin.apps.length ? admin.auth() : null as any;
// NOTE (Stage 1 migration): Firestore (adminDb) has been removed. Role/tenant
// lookups now read from Supabase — see ./supabase-admin.ts.

// Used to send order-status push notifications (seen-companion-app-task_1.md
// Phase 2). Actually sending requires a real service-account credential
// (the "Project ID only" fallback above constructs an app that can't sign
// FCM sends) -- callers must expect adminMessaging.send() to reject when
// FIREBASE_SERVICE_ACCOUNT isn't configured, and must not let that fail the
// caller's own request (see notifyOrderStatusChange's try/catch pattern).
export const adminMessaging = admin.apps.length ? admin.messaging() : null as any;
