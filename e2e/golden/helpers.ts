import { expect, type Page } from '@playwright/test';
import { STAFF, TEST_PASSWORD } from './fixtures';

/**
 * Signs in with email and password, as the shop's people do. When the
 * account is already signed in elsewhere (an earlier path), the app asks
 * whether to move the session here -- answered yes, as a person would.
 */
export async function signIn(page: Page, who: keyof typeof STAFF): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('example@mail.com أو 05xxxxxxxx').fill(STAFF[who].email);
  await page.getByPlaceholder('••••••••').first().fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'تسجيل الدخول' }).first().click();

  const moveHere = page.getByRole('button', { name: 'نعم، الدخول في هذا الجهاز' });
  await expect.poll(async () => !/\/login/.test(page.url()) || (await moveHere.isVisible()), { timeout: 30_000 }).toBe(true);
  if (await moveHere.isVisible()) await moveHere.click();

  // Out of the sign-in page, into the app.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await dismissTour(page);
}

/** The first-visit tour covers the screen; a person skips it. */
export async function dismissTour(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: 'تخطي' });
  try {
    await skip.waitFor({ state: 'visible', timeout: 5_000 });
    await skip.click();
  } catch {
    /* no tour this time */
  }
}
