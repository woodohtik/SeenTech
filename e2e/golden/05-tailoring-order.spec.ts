import { expect, test } from '@playwright/test';
import { db } from './db';
import { CUSTOMER, FABRIC, SHOP } from './fixtures';
import { signIn } from './helpers';

// Golden path 5 (seen-merchant-trial-test-2026-11-26.md, phase 2 items 2, 3
// and 6): a tailoring order for a returning customer comes filled with their
// preferences; at cutting the thobe's buttons leave stock with the cloth,
// once; moving it to "ready" offers to tell the customer. Checked in the database.

test.use({ viewport: { width: 820, height: 1180 } });

const BUTTONS = { id: '0e000000-0000-4000-8000-0000000000f5', name: 'أزرار الاختبار', stock: 200 };

test.beforeAll(async () => {
  const sb = db();
  // The customer's saved preferences: hard padding, Saudi cutting, a visible pocket.
  await sb.from('customers').update({
    measurements: { length: 145, chest: 104, sleeve: 62, collarPadding: 'hard', cuttingType: 'saudi', pocketType: 'visible' },
  }).eq('id', CUSTOMER.id);
  // Buttons in stock, and "a thobe takes 5 buttons" kept once by the shop.
  await sb.from('inventory_items').upsert({ id: BUTTONS.id, tenant_id: SHOP.tenantId, name: BUTTONS.name, sku: 'GOLDEN-BUTTONS', category: 'accessories', unit: 'piece', base_unit: 'piece', conversion_rate: 1, price_per_unit: 1, min_threshold: 0 });
  await sb.from('branch_inventory').upsert({ tenant_id: SHOP.tenantId, branch_id: SHOP.branchId, item_id: BUTTONS.id, quantity: BUTTONS.stock }, { onConflict: 'tenant_id,branch_id,item_id,variant_id' }).then(async ({ error }) => {
    if (error) await sb.from('branch_inventory').update({ quantity: BUTTONS.stock }).eq('tenant_id', SHOP.tenantId).eq('item_id', BUTTONS.id);
  });
  const { error } = await sb.from('garment_components').upsert({ tenant_id: SHOP.tenantId, garment_type: 'ثوب', item_id: BUTTONS.id, quantity: 5 }, { onConflict: 'tenant_id,garment_type,item_id' });
  if (error) throw new Error(`components seed: ${error.message}`);
});

const buttonsStock = async () => {
  const { data } = await db().from('branch_inventory').select('quantity').eq('tenant_id', SHOP.tenantId).eq('item_id', BUTTONS.id).is('variant_id', null);
  return Number(data?.[0]?.quantity ?? 0);
};

test("a returning customer's order, its buttons at cutting, and the 'ready' message", async ({ page }) => {
  test.setTimeout(150_000);
  const startedAt = new Date().toISOString();
  await signIn(page, 'owner');
  await page.goto('/orders');
  await page.getByText('إنشاء طلب جديد').first().click();
  const form = page.getByRole('dialog', { name: 'إنشاء طلب جديد' });

  // The customer's preferences fill the line, and the form says so.
  await form.getByRole('button', { name: 'اختر عميل...' }).click();
  await page.getByRole('option', { name: CUSTOMER.name }).click();
  await expect(form.getByText(`تم تعبئة تفضيلات ${CUSTOMER.name}`)).toBeVisible();
  await expect(form.getByRole('button', { name: 'قاسي' })).toHaveAttribute('aria-pressed', 'true');
  await expect(form.getByRole('button', { name: 'سعودي' })).toHaveAttribute('aria-pressed', 'true');

  await form.getByRole('button', { name: /اختر التاريخ/ }).click();
  await page.getByRole('button', { name: 'اليوم' }).click();
  await form.getByRole('button', { name: 'اختر قماش...' }).click();
  await page.getByRole('option', { name: new RegExp(FABRIC.name) }).first().click();
  await form.getByRole('spinbutton', { name: 'سعر القطعة' }).fill('250');
  await form.getByRole('button', { name: 'تأكيد وإنشاء الطلب' }).click();
  await expect(form).toBeHidden({ timeout: 20_000 });

  const { data: orders } = await db().from('orders').select('id, order_number, kind, components_taken_at')
    .eq('tenant_id', SHOP.tenantId).eq('customer_id', CUSTOMER.id).eq('kind', 'tailoring').gte('created_at', startedAt).order('created_at', { ascending: false }).limit(1);
  expect(orders, 'the tailoring order is saved').toHaveLength(1);
  const order = orders![0];
  const { data: lines } = await db().from('order_items').select('collar_padding, cutting_type, pocket_type').eq('order_id', order.id);
  expect(lines?.[0], `the line carries the customer's preferences: ${JSON.stringify(lines)}`).toMatchObject({ collar_padding: 'hard', cutting_type: 'saudi', pocket_type: 'visible' });

  // Cutting: the 5 buttons with the cloth, in the same move.
  const before = await buttonsStock();
  await page.getByPlaceholder('ابحث برقم الطلب أو اسم العميل...').fill(String(order.order_number));
  await page.getByRole('button', { name: 'التفاصيل' }).first().click();
  const details = page.getByRole('dialog', { name: 'تفاصيل الطلب' });
  await details.getByRole('button', { name: 'أخذ المقاسات' }).click();
  await page.getByRole('option', { name: 'قص القماش' }).click();
  const cutting = page.getByRole('dialog', { name: 'خصم القماش عند القص' });
  await expect(cutting.getByRole('spinbutton', { name: `كمية ${BUTTONS.name}` })).toHaveValue('5');
  await cutting.getByRole('button', { name: 'خصم ونقل الطلب' }).click();
  await expect(cutting).toBeHidden({ timeout: 20_000 });

  await expect.poll(buttonsStock, { message: '5 buttons left stock at cutting' }).toBe(before - 5);
  const { data: cut } = await db().from('orders').select('components_taken_at').eq('id', order.id).single();
  expect(cut?.components_taken_at, 'the order remembers its components were taken').toBeTruthy();

  // On to "ready": nothing moves twice, and the WhatsApp suggestion appears.
  await details.getByRole('button', { name: 'قص القماش' }).click();
  await page.getByRole('option', { name: 'جاهز للاستلام' }).click();
  await expect(page.getByRole('dialog', { name: 'الطلب جاهز' })).toBeVisible({ timeout: 20_000 });
  expect(await buttonsStock(), 'the buttons are taken once only').toBe(before - 5);
});
