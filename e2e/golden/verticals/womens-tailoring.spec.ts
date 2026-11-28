import { expect, test } from '@playwright/test';
import { db } from '../db';
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

// Wave 1 (shared item 2): a fitting booked from the order's details.
test('womens_tailoring: a fitting booked on the order', async ({ page }) => {
  await signInAs(page, shop.ownerEmail);
  await page.goto('/orders', { waitUntil: 'domcontentloaded' });
  // The flow above delivered this order: it is in the completed tab.
  await page.getByRole('button', { name: 'الطلبات المكتملة' }).first().click();
  await page.getByRole('button', { name: 'التفاصيل' }).first().click();
  const section = page.getByTestId('order-appointments');
  await expect(section).toBeVisible({ timeout: 15_000 });
  await section.getByRole('button', { name: 'موعد جديد' }).click();
  const when = new Date(Date.now() + 3 * 86400000);
  const local = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}T16:30`;
  await section.getByLabel('الوقت').fill(local);
  await section.getByLabel('ملاحظة').fill('البروفة الأولى');
  await section.getByRole('button', { name: 'احجز الموعد' }).click();
  await expect(section.getByText('البروفة الأولى')).toBeVisible({ timeout: 15_000 });
  const { data } = await db().from('appointments').select('kind, notes').eq('order_id', shop.order!.id);
  expect(data).toEqual([{ kind: 'fitting', notes: 'البروفة الأولى' }]);
});
