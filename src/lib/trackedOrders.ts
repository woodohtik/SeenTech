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
 */
import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'seen_tracked_orders';

async function getPreferencesPlugin() {
  const { Preferences } = await import('@capacitor/preferences');
  return Preferences;
}

export async function getSavedTrackingTokens(): Promise<string[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const Preferences = await getPreferencesPlugin();
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
    const Preferences = await getPreferencesPlugin();
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
    const Preferences = await getPreferencesPlugin();
    const tokens = await getSavedTrackingTokens();
    const next = tokens.filter((t) => t !== token);
    await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(next) });
  } catch {
    // non-fatal -- worst case a stale order lingers in the list until removed again
  }
}
