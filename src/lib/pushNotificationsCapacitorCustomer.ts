/**
 * pushNotificationsCapacitorCustomer.ts — native push registration for the
 * customer Android app (seen-companion-app-android-task.md, Track B,
 * Phase ب4).
 *
 * Same rationale as pushNotificationsCapacitor.ts (the staff equivalent):
 * Web Push via a browser service worker isn't reliable in a Capacitor
 * WebView for background delivery, so this uses @capacitor/push-notifications
 * (native FCM) instead. Kept as its own module rather than a shared one
 * with the staff version because the server contract differs in shape: one
 * staff device subscribes once (by staff_id), but one customer device can
 * be tracking several orders at once, each needing its own subscription
 * row keyed by that order's tracking_token
 * (POST /api/public/order-tracking/:token/subscribe) -- no server or
 * database change either way.
 */
import { Capacitor } from '@capacitor/core';
import { getSavedTrackingTokens } from './trackedOrders';
import { apiUrl } from './apiBase';

async function getPushNotificationsPlugin() {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  return PushNotifications;
}

async function subscribeTokenToAllTrackedOrders(fcmToken: string): Promise<void> {
  const trackingTokens = await getSavedTrackingTokens();
  await Promise.allSettled(
    trackingTokens.map((token) =>
      fetch(apiUrl(`/api/public/order-tracking/${token}/subscribe`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fcmToken }),
      })
    )
  );
}

/**
 * Requests permission and registers for native push once. Call on app
 * startup -- safe to call repeatedly.
 */
export async function initCustomerPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const PushNotifications = await getPushNotificationsPlugin();

    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return;

    // Fires on every register() call with the current device token --
    // re-subscribes it against every tracked order each time, so a newly
    // added order also ends up covered without a second registration flow.
    await PushNotifications.addListener('registration', (token) => {
      void subscribeTokenToAllTrackedOrders(token.value);
    });

    await PushNotifications.addListener('registrationError', (err) => {
      console.warn('[pushNotificationsCapacitorCustomer] registration error:', err);
    });

    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const url = (action.notification.data as any)?.link;
      if (typeof url === 'string') {
        try {
          const path = new URL(url).pathname + new URL(url).search;
          window.location.href = path;
        } catch {
          // Malformed/unexpected payload -- do nothing rather than navigate somewhere wrong.
        }
      }
    });

    await PushNotifications.register();
  } catch (e) {
    console.warn('[pushNotificationsCapacitorCustomer] init failed (non-fatal):', e);
  }
}

/**
 * Call after a new order is added to the tracked list so the existing
 * device token (if any) also gets subscribed for it, without waiting for
 * a fresh permission/registration cycle. Cheap and idempotent -- Android
 * re-fires the 'registration' listener above with the (usually unchanged)
 * current token.
 */
export async function reRegisterPushForTrackedOrders(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const PushNotifications = await getPushNotificationsPlugin();
    await PushNotifications.register();
  } catch (e) {
    console.warn('[pushNotificationsCapacitorCustomer] re-register failed (non-fatal):', e);
  }
}
