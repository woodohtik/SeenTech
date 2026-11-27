import { expect, test } from '@playwright/test';
import { db } from './db';
import { FABRIC, SHOP } from './fixtures';
import { signIn } from './helpers';

// Golden path 6 (seen-merchant-trial-test-2026-11-26.md, phase 3 items 1 and
// 5): stock on hand enters as an opening balance, in the item's own unit; a
// purchase order gets the shop's next number (PO-0001), not the clock's.

const SUPPLIER = { id: '0e000000-0000-4000-8000-0000000000a6', name: 'مؤسسة الحرير للأقمشة' };

test.beforeAll(async () => {
  const { error } = await db().from('suppliers').upsert({ id: SUPPLIER.id, tenant_id: SHOP.tenantId, name: SUPPLIER.name, phone: '0500000066', category: 'fabric' });
  if (error) throw new Error(`supplier seed: ${error.message}`);
});

test('a new cloth with 2 rolls of 30 yards on hand: 54.864 m in stock, recorded once', async ({ page }) => {
  await signIn(page, 'owner');
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'إضافة منتج' }).first().click();
  await page.getByRole('textbox', { name: 'اسم المنتج*' }).fill('ياباني أبيض');
  await page.getByRole('spinbutton', { name: 'محتوى الطاقة*' }).fill('30');
  await page.getByRole('spinbutton', { name: 'سعر الشراء (التكلفة) للمتر*' }).fill('12');
  await page.getByRole('spinbutton', { name: 'سعر البيع للمتر*' }).fill('20');
  await page.getByRole('spinbutton', { name: 'الرصيد الافتتاحي' }).fill('2');
  await page.getByRole('button', { name: 'حفظ المنتج' }).click();

  let itemId = '';
  await expect.poll(async () => {
    const { data } = await db().from('inventory_items').select('id').eq('tenant_id', SHOP.tenantId).eq('name', 'ياباني أبيض');
    itemId = data?.[0]?.id ?? '';
    return itemId;
  }, { timeout: 20_000, message: 'the item is saved' }).not.toBe('');
  await expect.poll(async () => {
    const { data } = await db().from('branch_inventory').select('quantity').eq('item_id', itemId).is('variant_id', null);
    return Number(data?.reduce((s, r) => s + Number(r.quantity), 0) ?? 0);
  }, { timeout: 20_000, message: '2 rolls x 30 yards in stock' }).toBeCloseTo(54.864, 3);
  const { data: op } = await db().from('stock_operations').select('operation_id').eq('operation_id', `opening_balance:${itemId}`);
  expect(op, 'recorded as the opening balance, once').toHaveLength(1);
});

test("a purchase order is numbered by the shop: PO-0001", async ({ page }) => {
  await signIn(page, 'owner');
  await page.goto('/suppliers');
  await page.getByRole('button', { name: 'المشتريات والمرتجعات' }).first().click();
  await page.getByRole('button', { name: 'إنشاء أمر شراء' }).first().click();
  await page.getByRole('button', { name: 'اختر المورد المسؤول...' }).click();
  await page.getByRole('option', { name: SUPPLIER.name }).click();
  await page.getByRole('button', { name: 'الصنف', exact: true }).click();
  await page.getByRole('option', { name: new RegExp(FABRIC.name) }).first().click();
  await page.getByRole('spinbutton', { name: 'السعر / وحدة' }).fill('12');
  await page.getByRole('button', { name: 'أضف الصنف لقائمة المستند' }).click();
  await page.getByRole('button', { name: 'حفظ كمسودة (بدون ترحيل)' }).click();

  await expect.poll(async () => {
    const { data } = await db().from('purchase_orders').select('po_number').eq('tenant_id', SHOP.tenantId).eq('supplier_id', SUPPLIER.id);
    return (data || []).map((r) => r.po_number);
  }, { timeout: 20_000, message: "the shop's own number" }).toEqual(['PO-0001']);
});
