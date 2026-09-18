import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';
import {visualizer} from 'rollup-plugin-visualizer';

export default defineConfig(({mode}) => {
  return {
    plugins: [
      react(),
      tailwindcss(),
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
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'سِين — إدارة محلات التفصيل',
          short_name: 'سِين',
          description: 'نظام سين لإدارة محلات التفصيل ونقاط البيع',
          lang: 'ar',
          dir: 'rtl',
          start_url: '/',
          display: 'standalone',
          background_color: '#F4F6F9',
          theme_color: '#1F3A5F',
          icons: [
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
          ],
          // Even after seen-offline-coverage-and-performance-task.md Phase
          // 6 (lazy-loaded locale files, vendor chunk splitting) the
          // largest chunks are still over Workbox's 2MiB default precache
          // limit, which fails the build entirely rather than just
          // skipping the oversized file. Raised, not disabled.
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          // A POS terminal realistically stays open on one tab for a whole
          // shift with no reload. Without these, a new service worker
          // installs but sits "waiting" until every tab is closed and
          // reopened -- meanwhile the precache stays pinned to whatever was
          // live when the tab was first opened, so any route not already
          // loaded into memory (each is a separately content-hashed lazy
          // chunk) has no valid offline entry to fall back on once a newer
          // deploy has shipped. Confirmed live: only the two routes already
          // open before a test went offline kept working; everything else
          // failed. skipWaiting + clientsClaim make a new service worker
          // activate and take over fetch handling for already-open tabs
          // immediately, without forcing a page reload (the tab's already
          // -rendered UI and any in-progress state are untouched) -- only
          // a NEW navigation/lazy-chunk fetch after that point uses the
          // fresh precache, which is exactly what "opening a tab offline"
          // needs.
          skipWaiting: true,
          clientsClaim: true,
        },
      }),
    ],
    build: {
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
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/.test(id)) return 'vendor-react';
            if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) return 'vendor-supabase';
            if (/[\\/]node_modules[\\/](@firebase|firebase)[\\/]/.test(id)) return 'vendor-firebase';
            if (/[\\/]node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'vendor-motion';
            if (/[\\/]node_modules[\\/]dexie[\\/]/.test(id)) return 'vendor-dexie';
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
