import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  return {
    plugins: [
      react(),
      tailwindcss(),
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
          globIgnores: ['**/firebase-messaging-sw.js'],
          // This app's main bundle is already ~2.2MB (a pre-existing
          // code-splitting gap, out of this task's scope) -- Workbox's
          // 2MiB default precache limit fails the build entirely rather
          // than just skipping the oversized file. Raised, not disabled.
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
