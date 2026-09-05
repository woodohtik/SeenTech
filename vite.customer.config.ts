import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

/**
 * Separate build for the customer Android app (io.seentech.customer,
 * seen-companion-app-android-task.md Track B). Builds index.customer.html
 * (-> src/main-customer.tsx -> AppCustomer.tsx) into dist-customer/,
 * entirely independent from the admin/POS build (vite.config.ts -> dist/)
 * so this public-facing app never bundles internal admin code. No
 * vite-plugin-pwa here -- this ships as a native Capacitor shell, not an
 * installable web app.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
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
});
