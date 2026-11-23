import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { i18nCorePlugin } from './scripts/vite-i18n-core';

// Separate from vite.config.ts (which carries the PWA plugin, customer-app
// build config, etc. -- none of it relevant to unit tests, and mixing them
// in risks import side effects unit tests shouldn't depend on).
export default defineConfig({
  // virtual:i18n-core/<lang> (src/i18n/config.ts) -- the same small module the build uses.
  plugins: [i18nCorePlugin(__dirname)],
  resolve: {
    alias: {
      // vite-plugin-pwa injects this specifier only inside the real Vite
      // build; aliased here so src/lib/pwaUpdate.ts (and its test, which
      // vi.mocks this same specifier) can load under vitest at all.
      'virtual:pwa-register': path.resolve(__dirname, 'src/test/virtualPwaRegisterStub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts', 'public/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // P6 (CODEHEALTH-14): the default 5 s is too tight for the tests that
    // render images, hash PINs or build the blog when the whole suite runs
    // in parallel -- they passed alone and timed out together.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
