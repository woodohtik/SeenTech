import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts (which carries the PWA plugin, customer-app
// build config, etc. -- none of it relevant to unit tests, and mixing them
// in risks import side effects unit tests shouldn't depend on).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
