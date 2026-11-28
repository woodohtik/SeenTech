import { expect, test } from '@playwright/test';
import { db } from './db';
import { PRODUCT, SHOP, STAFF } from './fixtures';
import { signIn } from './helpers';

// Golden paths 7 and 8 (seen-stability-guardrails-task.md, phase 1), one
// after the other in the same shift: the POS sale of path 2 is returned
// (the item back in stock, the return recorded), then the shift is closed
// with the drawer counted -- what is counted matches what is expected.

test.describe.configure({ mode: 'serial' });

const productStock = async () => {
  const { data } = await db().from('branch_inventory').select('quantity').eq('tenant_id', SHOP.tenantId).eq('item_id', PRODUCT.id).is('variant_id', null);
  return Number(data?.[0]?.quantity ?? 0);
};

test('the POS sale is returned: the item back in stock, the return recorded', async ({ page }) => {
  const { data: invoices } = await db().from('tax_invoices').select('invoice_number, order_id')
    .eq('tenant_id', SHOP.tenantId).order('created_at', { ascending: true }).limit(1);
  test.skip(!invoices?.length, 'no sale to return (path 2 did not run)');
  const invoice = invoices![0];
  const before = await productStock();

  await signIn(page, 'owner');
  await page.goto('/sales');
  await page.getByRole('button', { name: 'المرتجعات' }).first().click();
  await page.getByPlaceholder('أدخل رقم الفاتورة أو رقم جوال العميل للبحث...').fill(String(invoice.invoice_number));
  await page.getByRole('button', { name: 'بحث' }).click();
  await page.getByPlaceholder('اكتب سبب الإرجاع هنا...').fill('مقاس غير مناسب');
  await page.getByRole('button', { name: 'تأكيد الإرجاع' }).first().click();
  const confirm = page.getByRole('dialog', { name: 'تأكيد عملية الإرجاع' });
  await confirm.getByRole('button').last().click();

  await expect.poll(async () => {
    const { data } = await db().from('sales_returns').select('id').eq('tenant_id', SHOP.tenantId).eq('order_id', invoice.order_id);
    return data?.length ?? 0;
  }, { timeout: 20_000, message: 'the return is recorded' }).toBe(1);
  await expect.poll(productStock, { message: 'the item is back in stock' }).toBe(before + 1);
});

test('the shift is closed with the drawer counted; counted matches expected', async ({ page }) => {
  const { data: open } = await db().from('shifts').select('id').eq('tenant_id', SHOP.tenantId).eq('staff_id', STAFF.owner.staffId).eq('status', 'open');
  test.skip(!open?.length, 'no open shift (path 2 did not run)');
  const shiftId = open![0].id;

  await signIn(page, 'owner');
  await page.goto('/sales');
  await page.getByRole('button', { name: 'نقطة البيع (POS)' }).first().click();
  await page.getByRole('button', { name: 'إغلاق الوردية' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'إغلاق الوردية' });
  // The expected cash, as the server works it out (sales in, refunds out).
  const { data: balance } = await db().rpc('get_shift_cash_balance', { p_shift_id: shiftId });
  const expected = Number((Array.isArray(balance) ? balance[0] : balance as any)?.total ?? 0);
  await dialog.getByRole('spinbutton').fill(String(expected));
  await dialog.getByRole('button', { name: 'تأكيد وإغلاق الوردية' }).click();

  await expect.poll(async () => {
    const { data } = await db().from('shifts').select('status').eq('id', shiftId).single();
    return data?.status;
  }, { timeout: 20_000, message: 'the shift is closed' }).toBe('closed');
  const { data: closed } = await db().from('shifts').select('*').eq('id', shiftId).single();
  const diff = Number((closed as any)?.actual_cash) - Number((closed as any)?.expected_cash);
  expect(Number((closed as any)?.actual_cash), 'the counted cash is kept').toBeCloseTo(expected, 2);
  expect(Math.abs(diff), `counted matches expected: ${JSON.stringify({ actual: (closed as any)?.actual_cash, expected: (closed as any)?.expected_cash })}`).toBeLessThan(0.01);
});
