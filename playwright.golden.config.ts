import { defineConfig, devices } from '@playwright/test';

/**
 * The golden paths (seen-stability-guardrails-task.md, phase 1): the day's
 * real work, end to end, against the app built on a LOCAL Supabase with
 * "محل الاختبار الآلي" (e2e/golden/seed.ts) -- each path checks the
 * database, not only the screen. CI's `golden` job starts everything; the
 * paths share one shop, so they run one after another.
 *
 *   npx playwright test -c playwright.golden.config.ts
 */
export default defineConfig({
  testDir: './e2e/golden',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never', outputFolder: 'playwright-golden-report' }]] : [['list']],
  use: {
    baseURL: process.env.GOLDEN_BASE_URL || 'http://localhost:3000',
    locale: 'ar-SA',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
