import { expect, test } from '@playwright/test';
import { signInAs } from '../helpers';
import { verticalPath } from './flow';
import { VERTICAL_SHOPS } from './shops';

// seen-open-verticals-task.md, phase 0: the golden path of womens_tailoring.
const shop = VERTICAL_SHOPS.find((s) => s.vertical === 'womens_tailoring')!;
verticalPath(shop);

// Wave 1 (question 2's default): a customer's measurements are the women's list, not the thobe's.
test("womens_tailoring: the customer form takes the women's measurements", async ({ page }) => {
  await signInAs(page, shop.ownerEmail);
  await page.goto('/customers', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'إضافة عميل جديد' }).first().click();
  await expect(page.getByLabel('الصدر (دوران)', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('الأرداف (الورك)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('تحت الصدر', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /مقاسات متقدمة/ }).click();
  await expect(page.getByLabel('تحت الصدر', { exact: true })).toBeVisible();
  // Not the thobe's.
  await expect(page.getByLabel('طول الكبك', { exact: true })).toHaveCount(0);
});
