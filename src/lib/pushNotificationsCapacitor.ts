/**
 * pushNotificationsCapacitor.ts — native push registration for the staff
 * Android app (seen-companion-app-android-task.md, Track A, Phase أ3).
 *
 * Deliberately a SEPARATE module from pushNotifications.ts, not a
 * modification of it: pushNotifications.ts keeps serving ordinary mobile
 * browser visitors (Web Push via a service worker + VAPID key) exactly as
 * before. Web Push service workers are not reliable inside an Android
 * WebView wrapped by Capacitor -- background execution is restricted
 * differently there than in a real browser tab, so background push
 * delivery with the app fully closed can't be trusted through that path.
 *
 * Native Capacitor apps get their FCM token straight from Google Play
 * Services via @capacitor/push-notifications instead -- no service
 * worker, no VAPID key, same underlying FCM project. The server-side
 * contract is IDENTICAL either way: POST /api/staff/push-subscribe with
 * { fcmToken }, stored in staff_push_subscriptions exactly as a browser
 * token would be. No server or database change for this at all.
 *
 * IMPORTANT: never return a Capacitor plugin object as the resolved value
 * of an async function -- Capacitor's native plugin objects are Proxies
 * that answer ANY property access, including `.then`, so returning one
 * through a promise boundary makes the JS engine's own promise-resolution
 * procedure treat it as a thenable and call `PushNotifications.then(...)`,
 * which throws `"PushNotifications.then() is not implemented on android"`
 * (confirmed live on device for the identical pattern in
 * pushNotificationsCapacitorCustomer.ts -- this hangs the whole init
 * indefinitely rather than throwing somewhere catchable). Always inline
 * the dynamic import at the call site instead.
 */
import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase/client';

async function sendTokenToServer(fcmToken: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch('/api/staff/push-subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ fcmToken }),
    });
  } catch (e) {
    console.warn('[pushNotificationsCapacitor] failed to register token (non-fatal):', e);
  }
}

/**
 * Requests permission and registers for native push. Call once after the
 * staff member is authenticated (e.g. right after resolveIdentity settles
 * with a real session) -- safe to call repeatedly, Android no-ops a
 * redundant register() and FCM tokens don't rotate often.
 */
export async function initNativePushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return;

    // Fires once registration with FCM completes; token changes (rare,
    // e.g. app reinstall) fire this again, re-upserting server-side --
    // staff_push_subscriptions is keyed on (staff_id, fcm_token) so this
    // never duplicates.
    await PushNotifications.addListener('registration', (token) => {
      void sendTokenToServer(token.value);
    });

    await PushNotifications.addListener('registrationError', (err) => {
      console.warn('[pushNotificationsCapacitor] registration error:', err);
    });

    // Foreground taps -- navigate to the order the push was about.
    // Background/closed-app taps are handled by the OS launching the
    // activity directly; App.tsx's own routing takes it from there once
    // the WebView loads the deep-linked URL the notification carries
    // (see notify-new-order/notify-status's `link` field in server.ts).
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
    console.warn('[pushNotificationsCapacitor] init failed (non-fatal):', e);
  }
}
