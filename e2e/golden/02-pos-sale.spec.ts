import { expect, test } from '@playwright/test';
import { db } from './db';
import { PRODUCT, SHOP, STAFF } from './fixtures';
import { signIn } from './helpers';

// Golden path 2: a sale at the POS, from opening the shift to the invoice
// (seen-stability-guardrails-task.md, phase 1) -- checked in the database.
test('the owner opens a shift, sells a ready-made item for cash, and the invoice is issued', async ({ page }) => {
  await signIn(page, 'owner');
  await page.goto('/sales');
  // The POS tab, then its POS sub-tab (the page may open on the sales record).
  const posTabs = page.getByRole('button', { name: 'نقطة البيع (POS)' });
  const openShift = page.getByRole('button', { name: 'تأكيد وفتح الوردية' });
  await posTabs.first().click();
  await openShift.waitFor({ timeout: 8_000 }).catch(() => posTabs.last().click());

  // No shift yet: the shift opener comes first.
  await openShift.click();
  const search = page.getByPlaceholder('ابحث عن منتج أو باركود...');
  await expect(search).toBeVisible();
  const { data: shifts } = await db().from('shifts').select('id, status').eq('tenant_id', SHOP.tenantId).eq('staff_id', STAFF.owner.staffId).eq('status', 'open');
  expect(shifts, 'the shift is open in the database').toHaveLength(1);

  // The item, then cash, then confirm (F8, Ctrl+1, F9 -- the cashier's shortcuts).
  await search.fill(PRODUCT.name);
  await page.getByText(PRODUCT.name).first().click();
  await page.keyboard.press('F8');
  await page.keyboard.press('Control+1');
  await page.keyboard.press('F9');

  // The database: one POS sale, 57.50 with VAT, paid, its tax invoice in the
  // ZATCA chain, and one item out of stock.
  await expect.poll(async () => {
    const { data } = await db().from('orders').select('id').eq('tenant_id', SHOP.tenantId).eq('kind', 'pos_sale');
    return data?.length ?? 0;
  }, { message: 'the sale is saved' }).toBe(1);
  const { data: order } = await db().from('orders').select('id, total_amount, paid_amount, kind').eq('tenant_id', SHOP.tenantId).eq('kind', 'pos_sale').single();
  expect(Number(order!.total_amount)).toBeCloseTo(PRODUCT.price * 1.15, 2);
  expect(Number(order!.paid_amount)).toBeCloseTo(PRODUCT.price * 1.15, 2);
  const { data: invoice } = await db().from('tax_invoices').select('invoice_hash, status').eq('order_id', order!.id).single();
  expect(invoice?.invoice_hash, 'the tax invoice carries its hash (PIH chain)').toBeTruthy();
  const { data: stock } = await db().from('branch_inventory').select('quantity').eq('item_id', PRODUCT.id).single();
  expect(Number(stock!.quantity)).toBe(PRODUCT.stock - 1);
});
