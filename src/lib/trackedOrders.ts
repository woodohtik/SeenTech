/**
 * trackedOrders.ts — local, on-device list of tracking_tokens the customer
 * has opened (seen-companion-app-android-task.md, Track B, Phase ب2/ب3).
 *
 * There is no customer account, so unlike the staff app there is no
 * server-side "my orders" list to fetch -- the /track/:token link itself
 * carries the only identity that exists. A native app has no such link to
 * open on every launch, so this is the substitute: remember every token
 * the customer has ever opened, on this device only, via
 * @capacitor/preferences. No new table, no server change.
 *
 * Native-only by design (mirrors pushNotificationsCapacitor.ts): a browser
 * visitor to /track/:token already gets a working page with no "my orders"
 * concept, and doesn't need this list.
 *
 * IMPORTANT: never return a Capacitor plugin object as the resolved value
 * of an async function (e.g. `async function get() { return Preferences; }`).
 * Capacitor's native plugin objects are Proxies that answer ANY property
 * access, including `.then` -- so returning one through a promise boundary
 * makes the JS engine's own promise-resolution procedure treat it as a
 * thenable and call `Preferences.then(...)`, which throws
 * `"Preferences.then() is not implemented on android"` (confirmed live on
 * device: this hung every call below indefinitely before this fix, since
 * the resulting rejection escaped as an unhandled promise rejection rather
 * than reaching the try/catch here). Always inline the dynamic import at
 * the call site instead.
 */
import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'seen_tracked_orders';

export async function getSavedTrackingTokens(): Promise<string[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** Returns true only if the token was newly added (not already tracked). */
export async function addTrackingToken(token: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !token) return false;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const tokens = await getSavedTrackingTokens();
    if (tokens.includes(token)) return false;
    tokens.push(token);
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(tokens) });
    return true;
  } catch {
    return false;
  }
}

export async function removeTrackingToken(token: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const tokens = await getSavedTrackingTokens();
    const next = tokens.filter((t) => t !== token);
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(next) });
  } catch {
    // non-fatal -- worst case a stale order lingers in the list until removed again
  }
}
