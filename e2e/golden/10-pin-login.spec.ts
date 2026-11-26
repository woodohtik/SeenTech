import { expect, test, type Page } from '@playwright/test';
import { db } from './db';
import { STAFF, TEST_PASSWORD } from './fixtures';

// Golden path 10 (seen-stability-guardrails-task.md, phase 1): the shop's
// device is signed in with the owner's account; an employee steps up and
// enters their 4-digit PIN. A wrong PIN is refused with a clear sentence.

const CASHIER_PIN = '2468';

test.beforeAll(async () => {
  // PINs are kept as plain 4 digits (an explicit product decision).
  const { error } = await db().from('staff').update({ pin_hash: CASHIER_PIN }).eq('id', STAFF.cashier.staffId);
  if (error) throw new Error(`pin seed: ${error.message}`);
});
test.afterAll(async () => {
  await db().from('staff').update({ pin_hash: null }).eq('id', STAFF.cashier.staffId);
});

async function deviceSignIn(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem('hasSeenOnboarding', 'true'); } catch { /* none */ } });
  await page.goto('/login');
  await page.getByPlaceholder('example@mail.com أو 05xxxxxxxx').fill(STAFF.owner.email);
  await page.getByPlaceholder('••••••••').first().fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'تسجيل الدخول' }).first().click();
  const moveHere = page.getByRole('button', { name: 'نعم، الدخول في هذا الجهاز' });
  const pinScreen = page.getByRole('heading', { name: 'دخول الموظفين' });
  await expect.poll(async () => (await moveHere.isVisible()) || (await pinScreen.isVisible()), { timeout: 30_000 }).toBe(true);
  if (await moveHere.isVisible()) await moveHere.click();
  await expect(pinScreen).toBeVisible({ timeout: 30_000 });
}

async function typePin(page: Page, pin: string) {
  for (const digit of pin) await page.getByRole('button', { name: digit, exact: true }).click();
}

test('the cashier steps up with their PIN', async ({ page }) => {
  await deviceSignIn(page);
  await typePin(page, CASHIER_PIN);
  await expect(page.getByRole('heading', { name: 'دخول الموظفين' })).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: new RegExp(STAFF.cashier.name) }).first()).toBeVisible();
  const { data } = await db().from('staff_acting_sessions').select('staff_id').eq('staff_id', STAFF.cashier.staffId);
  expect(data?.length, 'an acting session for the cashier').toBeGreaterThan(0);
});

test('a wrong PIN is refused with a clear sentence', async ({ page }) => {
  await deviceSignIn(page);
  await typePin(page, '1111');
  await expect(page.getByText('رمز الدخول غير صحيح')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'دخول الموظفين' })).toBeVisible();
});
