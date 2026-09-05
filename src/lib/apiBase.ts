/**
 * apiBase.ts — absolute API origin for the customer Android app only.
 *
 * The customer app ships as a BUNDLED webDir build, not a server.url
 * live-reload shell like the staff app (Play Store favors real,
 * self-contained apps over bare WebView-to-a-live-site wrappers -- see
 * capacitor-customer/capacitor.config.ts). A bundled app's WebView has no
 * real network origin to resolve a relative fetch('/api/...') against, so
 * native builds need the full origin. Browser visits (including the admin
 * app's own /track/:token route) keep using relative paths exactly as
 * before -- this only changes behavior inside Capacitor.
 */
import { Capacitor } from '@capacitor/core';

const API_ORIGIN = (import.meta.env.VITE_CUSTOMER_API_ORIGIN as string | undefined) || 'https://staging.seentech.io';

export function apiUrl(path: string): string {
  return Capacitor.isNativePlatform() ? `${API_ORIGIN}${path}` : path;
}
