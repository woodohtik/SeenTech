import { expect, type Page } from '@playwright/test';
import { STAFF, TEST_PASSWORD } from './fixtures';

/** Signs in with email and password, as the shop's people do. */
export async function signIn(page: Page, who: keyof typeof STAFF): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('example@mail.com أو 05xxxxxxxx').fill(STAFF[who].email);
  await page.getByPlaceholder('••••••••').first().fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'تسجيل الدخول' }).first().click();
  // Out of the sign-in page, into the app.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}
