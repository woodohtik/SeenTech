import { expect, test } from '@playwright/test';
import { db } from './db';
import { STAFF } from './fixtures';
import { signIn } from './helpers';

// Golden path 1: signing in (seen-stability-guardrails-task.md, phase 1).
test('the owner signs in and reaches the shop', async ({ page }) => {
  const before = Date.now();
  await signIn(page, 'owner');
  // The shop's screens, not an error or an onboarding screen.
  await expect(page.getByText('محل الاختبار الآلي').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('تعذّر');

  // The database: the sign-in happened for this user, now.
  const { data } = await db().auth.admin.listUsers({ perPage: 100 });
  const user = data.users.find((u) => u.email === STAFF.owner.email);
  expect(user?.last_sign_in_at, 'the owner has signed in').toBeTruthy();
  expect(new Date(user!.last_sign_in_at!).getTime()).toBeGreaterThanOrEqual(before - 5_000);
});

test('a wrong password is refused with a clear sentence', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('example@mail.com أو 05xxxxxxxx').fill(STAFF.owner.email);
  await page.getByPlaceholder('••••••••').first().fill('not-the-password-1');
  await page.getByRole('button', { name: 'تسجيل الدخول' }).first().click();
  await expect(page.getByRole('alert')).toContainText('غير صحيحة');
  await expect(page).toHaveURL(/\/login/);
});
