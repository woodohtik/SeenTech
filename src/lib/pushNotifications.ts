/**
 * pushNotifications.ts — customer-facing FCM Web Push opt-in for the public
 * order tracking page (seen-companion-app-task_1.md, Phase 2). No account,
 * no user identity involved: the FCM device token is registered against
 * the order's tracking_token only (server side, see
 * POST /api/public/order-tracking/:token/subscribe).
 */
import { app, finalConfig } from './firebase';

export type SubscribeResult = 'granted' | 'denied' | 'unsupported' | 'error';

let messagingPromise: Promise<import('firebase/messaging').Messaging | null> | null = null;

async function getMessagingInstance() {
  if (!messagingPromise) {
    messagingPromise = (async () => {
      if (!app) return null;
      const { isSupported, getMessaging } = await import('firebase/messaging');
      if (!(await isSupported())) return null;
      return getMessaging(app);
    })();
  }
  return messagingPromise;
}

export async function subscribeToOrderNotifications(trackingToken: string): Promise<SubscribeResult> {
  try {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) {
      return 'unsupported';
    }

    const messaging = await getMessagingInstance();
    if (!messaging) return 'unsupported';

    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim();
    if (!vapidKey) {
      console.error('[pushNotifications] VITE_FIREBASE_VAPID_KEY is not configured.');
      return 'error';
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';

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
    if (!fcmToken) return 'error';

    const res = await fetch(`/api/public/order-tracking/${trackingToken}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fcmToken }),
    });
    return res.ok ? 'granted' : 'error';
  } catch (e) {
    console.error('[pushNotifications] subscribe failed:', e);
    return 'error';
  }
}
