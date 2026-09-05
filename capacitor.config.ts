import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Staff Android app (io.seentech.staff) -- seen-companion-app-android-task.md
 * Track A. Internal B2B tool, not a Play Store app (direct signed-APK
 * distribution). Wraps the LIVE staging site rather than a bundled `dist`
 * snapshot: this app changes constantly (see this repo's own commit
 * history), and a bundled-assets build would need a full APK rebuild +
 * redistribution to every staff phone for every web fix. Auth, role
 * gating, and every route guard already live entirely in the web app
 * itself -- this config adds zero new auth path, it's the same site in a
 * chrome-less WebView.
 *
 * Points at staging by default, matching this project's standing "all
 * dev goes to staging only" convention -- switch CAPACITOR_SERVER_URL to
 * the production origin only with the same explicit go-ahead this repo
 * already requires for any production publish.
 */
const SERVER_ORIGIN = process.env.CAPACITOR_SERVER_URL || 'https://staging.seentech.io';

const config: CapacitorConfig = {
  appId: 'io.seentech.staff',
  appName: 'سِين',
  webDir: 'dist',
  server: {
    // Starts directly on the staff PIN/login screen, not the public
    // marketing landing page -- there is no reason for a staff member's
    // installed app to ever show that.
    url: `${SERVER_ORIGIN}/login`,
    // Same-origin only: a staff member tapping a link (e.g. a WhatsApp
    // share, a support link) inside the WebView must never navigate this
    // app's single WebView away to an arbitrary external site.
    allowNavigation: [new URL(SERVER_ORIGIN).hostname],
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
