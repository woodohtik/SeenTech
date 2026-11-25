import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {sentryVitePlugin} from '@sentry/vite-plugin';
import {buildIdPlugin, buildIdentity, sentryRelease} from './scripts/vite-build-id';

/**
 * Separate build for the customer Android app (io.seentech.customer,
 * seen-companion-app-android-task.md Track B). Builds index.customer.html
 * (-> src/main-customer.tsx -> AppCustomer.tsx) into dist-customer/,
 * entirely independent from the admin/POS build (vite.config.ts -> dist/)
 * so this public-facing app never bundles internal admin code. No
 * vite-plugin-pwa here -- this ships as a native Capacitor shell, not an
 * installable web app.
 */
export default defineConfig(({mode}) => {
  // seen-readiness-fixes-task.md P4 (OPERATIONS-15): the app has no page origin
  // of its own, so it calls the API at VITE_CUSTOMER_API_ORIGIN. A build without
  // it used to talk to staging silently -- now it does not build.
  //   VITE_CUSTOMER_API_ORIGIN="https://www.seentech.io" npm run build:customer
  const env = loadEnv(mode, process.cwd(), '');
  if (!env.VITE_CUSTOMER_API_ORIGIN) {
    throw new Error('build:customer needs VITE_CUSTOMER_API_ORIGIN (the site this app calls, e.g. https://www.seentech.io).');
  }
  return {
  // P6 (CODEHEALTH-13): no console.log / console.debug in production bundles.
  esbuild: mode === 'production' ? { pure: ['console.log', 'console.debug'], drop: ['debugger'] } : undefined,
  plugins: [
    react(),
    tailwindcss(),
    // seen-sentry-setup-task.md: the same release and environment as the main
    // app, and (with SENTRY_AUTH_TOKEN) hidden maps uploaded then deleted.
    buildIdPlugin(__dirname),
    Boolean(process.env.SENTRY_AUTH_TOKEN) && sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT || 'seen-web',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: sentryRelease(__dirname, buildIdentity(__dirname)), inject: false },
      sourcemaps: { filesToDeleteAfterUpload: ['./dist-customer/**/*.map'] },
      telemetry: false,
    }),
  ],
  build: {
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false,
    outDir: 'dist-customer',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.customer.html'),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  };
});
