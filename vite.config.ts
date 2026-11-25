import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';
import {visualizer} from 'rollup-plugin-visualizer';
import {i18nCorePlugin} from './scripts/vite-i18n-core';
import {buildIdPlugin, buildIdentity, sentryRelease} from './scripts/vite-build-id';
import {sentryVitePlugin} from '@sentry/vite-plugin';

// seen-sentry-setup-task.md 2: with SENTRY_AUTH_TOKEN (Vercel builds) the
// source maps are made "hidden" (no link from the code), uploaded to
// Sentry's seen-web project under the same release as the code, and
// deleted from dist/ -- nobody can read the original code from the site.
// Without the key (local, a branch without it), no maps and no upload.
const SENTRY_UPLOAD = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default defineConfig(({mode}) => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      i18nCorePlugin(__dirname),
      // __BUILD_ID__ and dist/version.json (seen-update-delivery-fix-task.md phase 1).
      buildIdPlugin(__dirname),
      // Bundle composition report (seen-offline-coverage-and-performance-
      // task.md Phase 6) -- opt-in via `ANALYZE=true npm run build` rather
      // than every build, since it's a diagnostic tool, not something a
      // normal deploy needs. Writes dist/stats.html, a treemap of what's
      // actually inside each chunk.
      process.env.ANALYZE === 'true' && visualizer({
        filename: 'dist/stats.html',
        gzipSize: true,
        brotliSize: true,
        template: 'treemap',
      }),
      // installability only (seen-companion-app-task_1.md Phase 2/4) --
      // FCM background push is a SEPARATE, independently-registered service
      // worker (public/firebase-messaging-sw.js, registered on-demand from
      // the /track/:token page only) rather than being folded into this
      // one, matching Firebase's own documented setup and avoiding coupling
      // push delivery to this SW's own update/precache lifecycle.
      VitePWA({
        // 'prompt': a new worker waits, and the app decides when it takes over
        // (src/lib/updateManager.ts, seen-update-delivery-fix-task.md phase 3):
        // at once on a safe screen, after the sale or the save otherwise --
        // never mid-sale (P3.4, RELIABILITY-08), never only on a tap.
        registerType: 'prompt',
        // seen-search-appearance-task.md: the new logo's icons.
        includeAssets: ['favicon.ico', 'favicon.svg', 'favicon-96x96.png', 'apple-touch-icon.png'],
        manifest: {
          name: 'سِين — إدارة محلات التفصيل',
          short_name: 'سِين',
          description: 'نظام سين لإدارة محلات التفصيل ونقاط البيع',
          lang: 'ar',
          dir: 'rtl',
          start_url: '/',
          display: 'standalone',
          background_color: '#F4F6F9',
          theme_color: '#0E2A42',
          // PNGs for installing on Android and the desktop (an SVG alone is not
          // enough there), a maskable one with a safe margin, the SVG last.
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: '/Logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          ],
        },
        workbox: {
          // firebase-messaging-sw.js must never be swept into this SW's own
          // precache -- it's fetched/registered separately, and Workbox
          // would otherwise try to precache it as a navigable asset.
          // The SaaS/SuperAdmin-only chunks are excluded too: Workbox's
          // default globPatterns sweeps every JS/CSS in dist/ regardless of
          // whether a regular tenant user will ever visit those routes, so
          // every client was downloading the whole admin surface area in
          // the background after first load for no benefit (2026-09-17
          // full-team review, performance-reviewer). They still load
          // normally via React.lazy on demand for the few accounts that
          // actually use them -- this only removes them from the
          // background precache.
          globIgnores: [
            '**/firebase-messaging-sw.js',
            '**/assets/SaaS*.js',
            '**/assets/SuperAdminDashboard-*.js',
            '**/assets/AdminTailors-*.js',
            // Static blog pages (scripts/build-blog.ts output) are separate
            // pre-rendered pages, not part of the app shell -- no reason to
            // precache every one of them into every tenant's SW install.
            'blog/**',
            // seen-performance-first-open-login-task.md Phase 6: the heavy,
            // rarely used files no longer download in the background on a
            // first visit (they competed with the app's own requests). Each
            // is cached on first use instead (runtimeCaching below), so it
            // still works offline after that. PDF/Excel/scanner/charts, the
            // Firebase SDK (push only), the English/Urdu language files
            // (Arabic stays), and the TTF fonts now that WOFF2 is served.
            '**/assets/html2pdf-*.js',
            '**/assets/html2canvas*.js',
            '**/assets/xlsx-*.js',
            '**/assets/pdfGenerator-*.js',
            '**/assets/ScannerModal-*.js',
            // The dashboard's revenue chart (CartesianChart, with AreaChart and
            // BarChart) is precached again: it is the first screen, and a
            // missing chart file there started the 23 Nov reload loop
            // (seen-update-delivery-fix-task.md 0.5.4).
            '**/assets/PieChart-*.js',
            '**/assets/index.es-*.js',
            '**/assets/purify.es-*.js',
            '**/assets/vendor-firebase-*.js',
            '**/assets/en-*.js',
            '**/assets/ur-*.js',
            '**/fonts/*.ttf',
            // Two big pages outside the founder's offline core (POS, sales,
            // orders, customers, dashboard stay precached): cached on their
            // first open instead, and offline-capable after that.
            '**/assets/Settings-*.js',
            '**/assets/InventoryManager-*.js',
          ],
          runtimeCaching: [
            {
              urlPattern: ({ url }) =>
                url.origin === self.location.origin &&
                /\/assets\/(html2pdf|html2canvas|xlsx|pdfGenerator|ScannerModal|PieChart|index\.es|purify\.es|vendor-firebase|en|ur|Settings|InventoryManager)[-.][^/]*\.js$/.test(url.pathname),
              handler: 'CacheFirst',
              options: {
                // v2: the old cache may hold an HTML page stored as a code
                // file (a missing file used to come back as index.html);
                // public/sw-extra.js deletes it. Only a real JavaScript 200
                // is kept now.
                cacheName: 'seen-on-demand-chunks-v2',
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 60 },
                cacheableResponse: { statuses: [200] },
                plugins: [{
                  cacheWillUpdate: async ({ response }) =>
                    response && response.status === 200 && /javascript/i.test(response.headers.get('content-type') || '')
                      ? response
                      : null,
                }],
              },
            },
            {
              // The shop's images in Storage (the invoice logo,
              // seen-invoice-layout-settings-task.md phase 5): kept after the
              // first view, so a receipt prints with its logo offline. Only a
              // real 200 image is kept.
              urlPattern: ({ url, request }) =>
                request.destination === 'image' && /\/storage\/v1\/object\/public\/uploads\/tenants\//.test(url.pathname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'seen-shop-images',
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 90 },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              // Pages come from the network first (phase 4.2): a normal reload
              // while online gets the newest build. Offline, or after 3
              // seconds without an answer, the precached index.html -- the
              // build this worker carries, so its code files are all here.
              // Not stored per URL: a page saved under an old build would
              // point at code files that are gone.
              urlPattern: ({ request, url }) =>
                request.mode === 'navigate'
                && url.origin === self.location.origin
                && !/^\/(api\/|blog(\/|$)|sitemap\.xml$|robots\.txt$)/.test(url.pathname),
              // NetworkFirst only because Workbox allows the 3-second timeout
              // with it; the plugin below stores no page, so after the
              // timeout the answer is the precached index.html.
              handler: 'NetworkFirst',
              options: {
                cacheName: 'seen-pages-unused',
                networkTimeoutSeconds: 3,
                plugins: [{ cacheWillUpdate: async () => null }],
                precacheFallback: { fallbackURL: 'index.html' },
              },
            },
          ],
          // Even after seen-offline-coverage-and-performance-task.md Phase
          // 6 (lazy-loaded locale files, vendor chunk splitting) the
          // largest chunks are still over Workbox's 2MiB default precache
          // limit, which fails the build entirely rather than just
          // skipping the oversized file. Raised, not disabled.
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // Old precaches from earlier Workbox versions go on activation.
          cleanupOutdatedCaches: true,
          // Pages are routed above (network first); no cache-first
          // navigation fallback any more.
          navigateFallback: null,
          // public/sw-extra.js: drops the old on-demand cache and, for the
          // rescue release, lets this worker take over by itself (phase 5).
          importScripts: ['/sw-extra.js'],
          // No skipWaiting/clientsClaim here: a new worker waits until the app
          // finds the screen safe (updateManager.ts); until then the open tab
          // keeps the worker -- and the precache -- of the build it runs, so
          // its own lazy pages still load offline. (The one-time rescue in
          // public/sw-extra.js is the exception.)
          // globIgnores above only keeps /blog/** out of the precache
          // manifest -- it does NOT stop the SW's navigation-fallback
          // routing from intercepting a navigation to /blog for a visitor
          // who already has this SW installed and serving the SPA shell,
          // which then has no /blog route and bounces the visitor away.
          // These are real static pages built by scripts/build-blog.ts,
          // not SPA routes, so they must never hit the fallback.
          navigateFallbackDenylist: [/^\/blog(\/|$)/, /^\/sitemap\.xml$/, /^\/robots\.txt$/],
        },
      }),
      SENTRY_UPLOAD && sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT || 'seen-web',
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: { name: sentryRelease(__dirname, buildIdentity(__dirname)), inject: false },
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        telemetry: false,
      }),
    ],
    // P6 (CODEHEALTH-13): console.log / console.debug calls are removed from
    // production bundles (warnings and errors stay, for Sentry and support).
    esbuild: mode === 'production' ? { pure: ['console.log', 'console.debug'], drop: ['debugger'] } : undefined,
    build: {
      sourcemap: SENTRY_UPLOAD ? 'hidden' : false,
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          // Phase 6 of seen-offline-coverage-and-performance-task.md:
          // splits the heaviest vendor libraries out of the app's own
          // entry chunk into their own files. This doesn't shrink total
          // bytes on a cold first visit, but these barely change between
          // deploys (unlike src/**), so a returning visitor's browser
          // reuses its cached copy instead of re-downloading React/
          // Supabase/motion/Dexie on every single release.
          manualChunks(id) {
            // P3.4 (RELIABILITY-17): each language's small core file gets its
            // own name, so the en-*/ur-* precache exclusions (the full files)
            // no longer catch it -- every language starts offline.
            const core = /^\0virtual:i18n-core\/([a-z]{2})$/.exec(id);
            if (core) return `i18n-core-${core[1]}`;
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/.test(id)) return 'vendor-react';
            if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) return 'vendor-supabase';
            if (/[\\/]node_modules[\\/](@firebase|firebase)[\\/]/.test(id)) return 'vendor-firebase';
            if (/[\\/]node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'vendor-motion';
            if (/[\\/]node_modules[\\/]dexie[\\/]/.test(id)) return 'vendor-dexie';
            // seen-performance-first-open-login-task.md Phase 2: with the app
            // shell lazy, Rollup split every shared lucide icon into its own
            // tiny file (~35 requests before the shell could render). One
            // icons chunk instead.
            if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons';
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
