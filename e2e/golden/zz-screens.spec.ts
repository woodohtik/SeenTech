import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import { db } from './db';
import { CUSTOMER, SHOP, STAFF } from './fixtures';
import { signIn } from './helpers';

/**
 * Not a check: screenshots of the screens in the design table of
 * seen-merchant-trial-test-2026-11-26.md (phase 4), at 400 / 820 / 1280 /
 * 1700, of the test shop (no real data). Run only with GOLDEN_SCREENS=1;
 * GOLDEN_SCREENS_LABEL names the set ("before" / "after").
 */
test.skip(!process.env.GOLDEN_SCREENS, 'screens only with GOLDEN_SCREENS=1');

const LABEL = process.env.GOLDEN_SCREENS_LABEL || 'screens';
const OUT = path.join('golden-screens', LABEL);
const WIDTHS = [400, 820, 1280, 1700] as const;
const HEIGHT: Record<number, number> = { 400: 860, 820: 1180, 1280: 800, 1700: 950 };
const ORDER_ID = '0e000000-0000-4000-8000-0000000000d1';
const TRACK = '0e000000-0000-4000-8000-0000000000e1';

test.beforeAll(async () => {
  const sb = db();
  // The trial banner shows only for a shop on trial.
  await sb.from('tenants').update({ subscription_status: 'trial', trial_ends_at: new Date(Date.now() + 6 * 86400000).toISOString() }).eq('id', SHOP.tenantId);
  await sb.from('suppliers').upsert({ id: '0e000000-0000-4000-8000-0000000000a1', tenant_id: SHOP.tenantId, name: 'مؤسسة الحرير للأقمشة', phone: '0500000077', category: 'fabric' });
  await sb.from('customers').update({ measurements: { length: 145, shoulder: 46, chest: 104, sleeve: 62, neck: 40, collarType: 'classic', pocketType: 'hidden', cuttingType: 'saudi', collarPadding: 'hard', closureType: 'buttons' } }).eq('id', CUSTOMER.id);
  const { error: orderError } = await sb.from('orders').upsert({
    id: ORDER_ID, tenant_id: SHOP.tenantId, customer_id: CUSTOMER.id, customer_name: CUSTOMER.name, order_number: 7,
    delivery_date: new Date(Date.now() + 9 * 86400000).toISOString(), total_amount: 115, paid_amount: 50,
    status: 'sewing', status_key: 'sewing', kind: 'tailoring', tracking_token: TRACK, branch_id: SHOP.branchId,
  });
  if (orderError) console.log(`[screens] order seed: ${orderError.message}`);
  // No PINs here: with one, an email sign-in lands on the PIN screen (golden path 10 covers it).
  await sb.from('staff').update({ pin_hash: null }).in('id', [STAFF.owner.staffId, STAFF.cashier.staffId]);
});

async function shot(page: Page, width: number, name: string, act?: () => Promise<unknown>) {
  try {
    if (act) await act();
    await page.waitForTimeout(1200);
    const dir = path.join(OUT, String(width));
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
    // The accessibility tree too: the golden paths are written from it.
    writeFileSync(path.join(dir, `${name}.yml`), await page.locator('body').ariaSnapshot().catch(() => ''));
  } catch (e) {
    console.log(`[screens] ${width} ${name}: ${(e as Error).message.split('\n')[0]}`);
  }
}

// Not "networkidle": the app keeps live connections open, so it never settles.
const go = async (page: Page, url: string) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500); };
const closeModal = (page: Page) => page.keyboard.press('Escape').catch(() => {});

for (const width of WIDTHS) {
  test(`screens at ${width}`, async ({ page }) => {
    test.setTimeout(420_000);
    await page.setViewportSize({ width, height: HEIGHT[width] });
    page.setDefaultTimeout(8_000);
    page.setDefaultNavigationTimeout(20_000);
    await signIn(page, 'owner');

    await shot(page, width, '01-dashboard', () => go(page, '/dashboard'));
    await shot(page, width, '02-suppliers', () => go(page, '/suppliers'));
    await shot(page, width, '03-purchases', async () => { await go(page, '/suppliers'); await page.getByRole('button', { name: 'المشتريات والمرتجعات' }).first().click(); });
    await shot(page, width, '04-new-po', () => page.getByRole('button', { name: 'إنشاء أمر شراء' }).first().click());
    await closeModal(page);
    await shot(page, width, '05-inventory', () => go(page, '/inventory'));
    await shot(page, width, '06-add-item', () => page.getByRole('button', { name: 'إضافة منتج' }).first().click());
    await closeModal(page);
    await shot(page, width, '07-settings', () => go(page, '/settings'));
    await shot(page, width, '08-staff', () => go(page, '/settings?tab=staff'));
    await shot(page, width, '09-add-staff', () => page.getByRole('button', { name: 'إضافة موظف' }).first().click());
    await closeModal(page);
    await shot(page, width, '10-customers', () => go(page, '/customers'));
    await shot(page, width, '11-add-customer', () => page.getByRole('button', { name: 'إضافة عميل جديد' }).first().click());
    await closeModal(page);
    await shot(page, width, '12-customer-profile', async () => { await go(page, '/customers'); await page.getByText(CUSTOMER.name).first().click(); });
    await shot(page, width, '13-orders', () => go(page, '/orders'));
    await shot(page, width, '14-order-details', async () => { await go(page, '/orders'); await page.getByText(CUSTOMER.name).first().click(); });
    await closeModal(page);
    await shot(page, width, '15-new-order', async () => { await go(page, '/orders'); await page.getByText('إنشاء طلب جديد').first().click(); });
    await shot(page, width, '16-calendar', () => page.getByRole('button', { name: /اختر التاريخ|تاريخ/ }).first().click());
    await closeModal(page);
    await shot(page, width, '17-pos', async () => {
      await go(page, '/sales');
      await page.getByRole('button', { name: 'نقطة البيع (POS)' }).first().click();
      const open = page.getByRole('button', { name: 'تأكيد وفتح الوردية' });
      if (await open.isVisible().catch(() => false)) await open.click();
    });
    await shot(page, width, '18-tracking', () => go(page, `/track/${TRACK}`));
    if (width === 1280) {
      // For golden paths 7-10: returns, closing a shift, the lock/PIN screen.
      await shot(page, width, '21-returns', async () => {
        await go(page, '/sales');
        await page.getByRole('button', { name: 'المرتجعات' }).first().click();
      });
      await shot(page, width, '22-shifts', async () => {
        await go(page, '/sales');
        await page.getByRole('button', { name: 'الورديات' }).first().click();
      });
      await shot(page, width, '23-close-shift', async () => {
        await go(page, '/sales');
        await page.getByRole('button', { name: 'نقطة البيع (POS)' }).first().click();
        await page.getByRole('button', { name: 'إغلاق الوردية' }).first().click();
      });
      await closeModal(page);
    }
    if (width === 820) {
      await shot(page, width, '19-order-status-menu', async () => {
        await go(page, '/orders');
        await page.getByText(CUSTOMER.name).first().click();
        await page.waitForTimeout(800);
        await page.getByRole('button', { name: /خياطة/ }).last().click();
      });
      await closeModal(page);
      await shot(page, width, '20-new-order-customer', async () => {
        await go(page, '/orders');
        await page.getByText('إنشاء طلب جديد').first().click();
        await page.getByRole('button', { name: /اختر عميل/ }).first().click();
      });
    }
  });
}

// What a cashier and a tailor see (golden path 9, permissions).
for (const who of ['cashier', 'tailor'] as const) {
  test(`screens as ${who}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    page.setDefaultTimeout(8_000);
    page.setDefaultNavigationTimeout(20_000);
    await signIn(page, who);
    await shot(page, 1280, `30-${who}-home`, () => page.waitForTimeout(1500));
    await shot(page, 1280, `31-${who}-settings`, () => go(page, '/settings?tab=staff'));
    await shot(page, 1280, `32-${who}-orders`, () => go(page, '/orders'));
  });
}
