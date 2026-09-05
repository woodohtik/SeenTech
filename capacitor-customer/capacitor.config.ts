import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Customer Android app (io.seentech.customer) -- seen-companion-app-android-task.md
 * Track B. Public-facing, Play Store-distributed (unlike the staff app's
 * direct-APK internal distribution) -- so unlike ../capacitor.config.ts,
 * this ships as a BUNDLED webDir build, not a server.url wrapper around a
 * live site. Google Play's Minimum Functionality policy disfavors apps
 * that are just a WebView pointed at a remote URL with no offline value;
 * a real bundled app (installable, works without waiting on a network
 * round-trip for the shell itself) is the safer, standard choice for a
 * public consumer app. API calls still reach the live backend -- see
 * src/lib/apiBase.ts, which switches relative fetch paths to an absolute
 * origin specifically inside this native shell.
 */
const config: CapacitorConfig = {
  appId: 'io.seentech.customer',
  appName: 'سِين',
  webDir: '../dist-customer',
  server: {
    // No live-site navigation out of this bundled shell -- same-origin
    // policy of the staff app's config, applied here for the same reason
    // (never let a tapped link carry the WebView somewhere external).
    allowNavigation: [],
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
