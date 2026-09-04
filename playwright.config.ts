import { defineConfig, devices } from '@playwright/test';

/**
 * seen-companion-app-task_1.md Phase 5.2 -- scenario tests for the public
 * order-tracking + push-notification flow. All backend calls are mocked
 * via page.route() rather than hitting real staging data or logging in
 * with a real staff account (this project's standing rule: no disposable
 * test accounts, ask a human to log in for anything that genuinely needs
 * a live session). That keeps these tests fully deterministic and safe to
 * run against the real staging origin without touching live data.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'html' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://staging.seentech.io',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
