import { expect, test } from '@playwright/test';
import { db } from './db';
import { SHOP } from './fixtures';
import { signIn } from './helpers';

// Golden path 12 (seen-product-variants-barcode-po-price-task.md): a product
// with variants -- white and black x 56 and 58 -- gets its barcodes generated,
// black a special price, and 10 pieces of opening stock shared out (3, 3, 2, 2);
// then a purchase order starts at the product's cost, a new price is typed,
// and confirming the order updates the product's cost (never its selling price).

const NAME = 'ثوب سمات الاختبار';
const SUPPLIER = { id: '0e000000-0000-4000-8000-0000000000a7', name: 'مورد السمات' };

function isEan13(code: string) {
  if (!/^\d{13}$/.test(code)) return false;
  const sum = code.slice(0, 12).split('').reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

test.beforeAll(async () => {
  const { error } = await db().from('suppliers').upsert({ id: SUPPLIER.id, tenant_id: SHOP.tenantId, name: SUPPLIER.name, phone: '0500000067', category: 'other' });
  if (error) throw new Error(`supplier seed: ${error.message}`);
});

test('a product with 4 variants: barcodes, a special price, the opening stock shared', async ({ page }) => {
  await signIn(page, 'owner');
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'إضافة منتج' }).first().click();

  await page.getByRole('button', { name: 'منتج متقدم (له سمات)' }).click();
  const categoryField = page.locator('div', { has: page.locator('label', { hasText: /^التصنيف$/ }) }).last();
  await categoryField.getByRole('button').first().click();
  // The test shop has no categories yet: add one, as a merchant would (pieces, not length).
  await page.getByRole('option', { name: 'إضافة فئة جديدة' }).click();
  await page.getByPlaceholder('اسم الفئة الجديدة').fill('أزياء جاهزة');
  await page.getByPlaceholder('اسم الفئة الجديدة').press('Enter');
  await expect(categoryField.getByRole('button').first()).toHaveText(/أزياء جاهزة/, { timeout: 15_000 });

  await page.getByRole('textbox', { name: /اسم المنتج/ }).fill(NAME);
  await page.getByRole('button', { name: 'توليد', exact: true }).click();
  await expect(page.getByPlaceholder(/أو اضغط «توليد»/)).toHaveValue(/^2\d{12}$/);
  await page.getByRole('spinbutton', { name: /سعر الشراء/ }).fill('60');
  await page.getByRole('spinbutton', { name: /سعر البيع/ }).fill('200');
  await page.getByRole('spinbutton', { name: 'الرصيد الافتتاحي' }).fill('10');

  // Colour x size.
  const nameBoxes = page.getByPlaceholder(/اسم السمة/);
  await nameBoxes.nth(0).fill('اللون');
  const valueBoxes = page.getByPlaceholder(/قيمة/);
  await valueBoxes.nth(0).fill('أبيض'); await valueBoxes.nth(0).press('Enter');
  await valueBoxes.nth(0).fill('أسود'); await valueBoxes.nth(0).press('Enter');
  await page.getByRole('button', { name: /إضافة سمة أخرى/ }).click();
  await nameBoxes.nth(1).fill('المقاس');
  await valueBoxes.nth(1).fill('56'); await valueBoxes.nth(1).press('Enter');
  await valueBoxes.nth(1).fill('58'); await valueBoxes.nth(1).press('Enter');
  await page.getByRole('button', { name: 'توليد المتغيّرات' }).click();

  // No barcode field on the rows; each price starts at the product's.
  const prices = page.getByRole('spinbutton', { name: 'السعر', exact: true });
  await expect(prices).toHaveCount(4);
  await expect(prices.first()).toHaveValue('200');
  // Black 56 gets its own price.
  await prices.nth(2).fill('260');
  await expect(page.getByText('سعر خاص').first()).toBeVisible();

  // The opening stock, shared: 10 on 4 = 3, 3, 2, 2.
  await page.getByRole('button', { name: 'وزّع على السمات' }).click();
  await expect(page.getByTestId('variant-opening')).toContainText('10');

  await page.getByRole('button', { name: /^تم ✓$/ }).click();
  await page.getByRole('button', { name: 'حفظ المنتج' }).click();

  let itemId = '';
  await expect.poll(async () => {
    const { data } = await db().from('inventory_items').select('id').eq('tenant_id', SHOP.tenantId).eq('name', NAME);
    itemId = data?.[0]?.id ?? '';
    return itemId;
  }, { timeout: 20_000, message: 'the product is saved' }).not.toBe('');

  let variants: any[] = [];
  await expect.poll(async () => {
    const { data } = await db().from('inventory_variants').select('id, name, barcode, price_override').eq('item_id', itemId).order('created_at');
    variants = data || [];
    return variants.length;
  }, { timeout: 20_000, message: 'its 4 variants' }).toBe(4);
  for (const v of variants) expect(isEan13(v.barcode ?? ''), `${v.name} has a valid EAN-13`).toBe(true);
  expect(new Set(variants.map((v) => v.barcode)).size, 'no two the same').toBe(4);
  expect(variants.filter((v) => v.price_override != null).map((v) => Number(v.price_override)), 'only black 56 has its own price').toEqual([260]);

  await expect.poll(async () => {
    const { data } = await db().from('branch_inventory').select('variant_id, quantity').eq('item_id', itemId).not('variant_id', 'is', null);
    return (data || []).map((r) => Number(r.quantity)).sort((a, b) => b - a);
  }, { timeout: 20_000, message: 'each variant has its share' }).toEqual([3, 3, 2, 2]);
  const { data: parent } = await db().from('branch_inventory').select('quantity').eq('item_id', itemId).is('variant_id', null);
  expect((parent || []).reduce((s, r) => s + Number(r.quantity), 0), 'nothing on the product itself').toBe(0);
});

test("a purchase order starts at the product's cost, and confirming a new price updates it", async ({ page }) => {
  await signIn(page, 'owner');
  await page.goto('/suppliers');
  await page.getByRole('button', { name: 'المشتريات والمرتجعات' }).first().click();
  await page.getByRole('button', { name: 'إنشاء أمر شراء' }).first().click();
  await page.getByRole('button', { name: 'اختر المورد المسؤول...' }).click();
  await page.getByRole('option', { name: SUPPLIER.name }).click();
  await page.getByRole('button', { name: 'اختر صنف المخزن...' }).click();
  await page.getByRole('option', { name: new RegExp(NAME) }).first().click();
  await page.getByRole('button', { name: /اختر السمة/ }).click();
  await page.getByRole('option').first().click();

  const price = page.getByRole('spinbutton', { name: 'السعر / وحدة' });
  await expect(price, "the product's purchase price").toHaveValue('60');
  await price.fill('65');
  await expect(page.getByTestId('po-price-hint')).toContainText('60.00');
  await expect(page.getByRole('checkbox', { name: /حدّث سعر المنتج/ })).toBeChecked();
  await page.getByRole('button', { name: 'أضف الصنف لقائمة المستند' }).click();
  await page.getByRole('button', { name: 'حفظ وتأكيد السند (ترحيل آلي)' }).click();

  await expect.poll(async () => {
    const { data } = await db().from('inventory_items').select('description, price_per_unit').eq('tenant_id', SHOP.tenantId).eq('name', NAME).single();
    const meta = JSON.parse(String(data?.description ?? '').slice('__INVENTORY_METADATA__:'.length) || '{}');
    return [Number(meta.costPrice), Number(data?.price_per_unit)];
  }, { timeout: 30_000, message: 'cost 65, selling price still 200' }).toEqual([65, 200]);
});
