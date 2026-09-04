/**
 * pushNotifications.ts — FCM Web Push opt-in, for two distinct audiences
 * (seen-companion-app-task_1.md):
 * - Phase 2: the customer on the public order-tracking page. No account,
 *   no identity -- the device token is registered against the order's
 *   tracking_token only (POST /api/public/order-tracking/:token/subscribe).
 * - Phase 3: a signed-in staff member, opting in from their own
 *   preferences menu, for "new order arrived" pushes when the app is
 *   closed. The device token is registered against their own staff_id,
 *   derived server-side from their auth session, never sent by the client
 *   (POST /api/staff/push-subscribe).
 */
import { app, finalConfig } from './firebase';
import { supabase } from './supabase/client';

export type SubscribeResult = 'granted' | 'denied' | 'unsupported' | 'error';

let messagingPromise: Promise<import('firebase/messaging').Messaging | 'unsupported' | null> | null = null;

// Distinguishes "browser genuinely can't do push" from "Firebase isn't
// configured on this deploy" -- both used to collapse into the same
// getMessagingInstance() -> null -> 'unsupported' result, which sent
// debugging toward a browser-compat red herring on any preview/staging
// deploy that simply hadn't gotten its Firebase env vars copied over yet
// (finalConfig.apiKey empty -> src/lib/firebase.ts sets app = null).
async function getMessagingInstance() {
  if (!messagingPromise) {
    messagingPromise = (async () => {
      if (!app) {
        console.error('[pushNotifications] Firebase is not configured (VITE_FIREBASE_* env vars missing) -- push is unavailable regardless of browser support.');
        return null;
      }
      const { isSupported, getMessaging } = await import('firebase/messaging');
      if (!(await isSupported())) return 'unsupported';
      return getMessaging(app);
    })();
  }
  return messagingPromise;
}

/**
 * Requests notification permission and returns a fresh FCM device token, or
 * null if permission was denied / the platform doesn't support it. Shared
 * by both the customer and staff opt-in flows below -- only what happens
 * with the resulting token (which endpoint it's POSTed to) differs.
 */
async function acquireFcmToken(): Promise<{ token: string } | { denied: true } | { unsupported: true } | { error: true }> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) {
    return { unsupported: true };
  }

  const messaging = await getMessagingInstance();
  if (messaging === 'unsupported') return { unsupported: true };
  if (!messaging) return { error: true }; // Firebase misconfigured, not a browser-support issue

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim();
  if (!vapidKey) {
    console.error('[pushNotifications] VITE_FIREBASE_VAPID_KEY is not configured.');
    return { error: true };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { denied: true };

  // firebase-messaging-sw.js is a plain static file with no build-time env
  // access -- pass the (non-secret, already-public-in-the-main-bundle)
  // Firebase config through the registration URL's query string.
  const swParams = new URLSearchParams({
    apiKey: finalConfig.apiKey,
    authDomain: finalConfig.authDomain,
    projectId: finalConfig.projectId,
    messagingSenderId: finalConfig.messagingSenderId,
    appId: finalConfig.appId,
  });
  // A distinct scope -- not the site root '/' -- so this registration
  // doesn't fight vite-plugin-pwa's own app-shell service worker
  // (registered at scope '/' on every page load) for control of the
  // page. Without this, whichever SW registers last on a given visit
  // would silently replace the other's control of scope '/', breaking
  // either offline precache or background push delivery.
  const registration = await navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?${swParams}`,
    { scope: '/firebase-cloud-messaging-push-scope' }
  );

  const { getToken } = await import('firebase/messaging');
  const fcmToken = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!fcmToken) return { error: true };
  return { token: fcmToken };
}

export async function subscribeToOrderNotifications(trackingToken: string): Promise<SubscribeResult> {
  try {
    const acquired = await acquireFcmToken();
    if ('unsupported' in acquired) return 'unsupported';
    if ('denied' in acquired) return 'denied';
    if ('error' in acquired) return 'error';

    const res = await fetch(`/api/public/order-tracking/${trackingToken}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fcmToken: acquired.token }),
    });
    return res.ok ? 'granted' : 'error';
  } catch (e) {
    console.error('[pushNotifications] subscribe failed:', e);
    return 'error';
  }
}

export async function subscribeStaffToNewOrderNotifications(): Promise<SubscribeResult> {
  try {
    const acquired = await acquireFcmToken();
    if ('unsupported' in acquired) return 'unsupported';
    if ('denied' in acquired) return 'denied';
    if ('error' in acquired) return 'error';

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return 'error';

    const res = await fetch('/api/staff/push-subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ fcmToken: acquired.token }),
    });
    return res.ok ? 'granted' : 'error';
  } catch (e) {
    console.error('[pushNotifications] staff subscribe failed:', e);
    return 'error';
  }
}
