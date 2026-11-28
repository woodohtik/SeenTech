import { expect, test } from '@playwright/test';
import { db } from '../db';
import { signInAs } from '../helpers';
import { verticalPath } from './flow';
import { VERTICAL_SHOPS } from './shops';

// seen-open-verticals-task.md, phase 0: the golden path of fabric_store.
const shop = VERTICAL_SHOPS.find((s) => s.vertical === 'fabric_store')!;
verticalPath(shop);

// Wave 1: 2.75 m typed at the POS is sold and taken from stock as 2.75 m.
test('fabric_store: 2.75 m typed at the POS', async ({ page }) => {
  await signInAs(page, shop.ownerEmail);
  await page.goto('/sales');
  const openShift = page.getByRole('button', { name: 'تأكيد وفتح الوردية' });
  await page.getByRole('button', { name: 'نقطة البيع (POS)' }).first().click();
  await openShift.waitFor({ timeout: 8_000 }).then(() => openShift.click(), () => page.getByRole('button', { name: 'بيع جديد' }).click().catch(() => {}));
  const search = page.getByPlaceholder('ابحث عن منتج أو باركود...');
  await expect(search).toBeVisible();
  await search.fill(shop.lengthItem.name);
  await page.getByText(shop.lengthItem.name).first().click();

  const length = page.getByRole('textbox', { name: 'الكمية' }).first();
  await length.click();
  await length.fill('2.75');
  await length.press('Enter');
  await page.keyboard.press('F8');
  await page.keyboard.press('Control+1');
  await page.keyboard.press('F9');

  await expect.poll(async () => {
    const { data } = await db().from('order_items').select('quantity, item_id').eq('item_id', shop.lengthItem.id);
    return (data || []).map((r) => Number(r.quantity));
  }, { timeout: 20_000, message: 'the sale line is 2.75 m' }).toEqual([2.75]);
  const { data: stock } = await db().from('branch_inventory').select('quantity').eq('item_id', shop.lengthItem.id).single();
  expect(Number(stock!.quantity)).toBeCloseTo(shop.lengthItem.stock - 2.75, 2);
});
