import { expect, test } from '@playwright/test';
import { db } from './db';
import { CUSTOMER, SHOP } from './fixtures';

// Golden path 4 (seen-merchant-trial-test-2026-11-26.md, phase 2 item 5): the
// customer's tracking page. A ready order said "9 days left", with nothing
// about what is left to pay or how to reach the shop.

const ORDER_ID = '0e000000-0000-4000-8000-0000000000d4';
const TOKEN = '0e000000-0000-4000-8000-0000000000e4';

test.beforeAll(async () => {
  const sb = db();
  await sb.from('tenants').update({ phone: '0110000000', address: 'حي النخيل', city: 'الرياض' }).eq('id', SHOP.tenantId);
  const { error } = await sb.from('orders').upsert({
    id: ORDER_ID, tenant_id: SHOP.tenantId, customer_id: CUSTOMER.id, customer_name: CUSTOMER.name, order_number: 44,
    delivery_date: new Date(Date.now() + 9 * 86400000).toISOString(), total_amount: 115, paid_amount: 50,
    status: 'ready', status_key: 'ready', kind: 'tailoring', tracking_token: TOKEN, branch_id: SHOP.branchId,
  });
  if (error) throw new Error(`order seed: ${error.message}`);
});

test('a ready order tells the customer so, with what is left and how to reach the shop', async ({ page }) => {
  await page.goto(`/track/${TOKEN}`);
  await expect(page.getByText('طلبك جاهز للاستلام 🎉')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/متبقي \d+ أيام/)).toHaveCount(0);
  await expect(page.getByText(/المبلغ المتبقي: 65/)).toBeVisible();
  await expect(page.getByRole('link', { name: /اتصل بالمحل/ })).toHaveAttribute('href', 'tel:0110000000');
  await expect(page.getByRole('link', { name: /موقع المحل/ })).toHaveAttribute('href', /google\.com\/maps/);
  await expect(page).toHaveTitle('تتبّع طلبك');
});

test('an unknown token shows no order', async ({ page }) => {
  await page.goto('/track/0e000000-0000-4000-8000-0000000000ff');
  await expect(page.getByText('طلبك جاهز للاستلام 🎉')).toHaveCount(0);
  await expect(page.getByText('محل الاختبار الآلي')).toHaveCount(0);
});
