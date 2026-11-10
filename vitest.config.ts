import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Separate from vite.config.ts (which carries the PWA plugin, customer-app
// build config, etc. -- none of it relevant to unit tests, and mixing them
// in risks import side effects unit tests shouldn't depend on).
export default defineConfig({
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
  },
});
