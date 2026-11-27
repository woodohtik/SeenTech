import { expect, test, type Page } from '@playwright/test';
import { db } from '../db';
import { signInAs } from '../helpers';
import type { VerticalShop } from './shops';

/**
 * A vertical's golden path (seen-open-verticals-task.md, phase 0 items 3-4):
 *   1. its screens never show another vertical's words (ثوب / خياط ...);
 *   2. a sale in the POS issues its tax invoice;
 *   3. an order goes through its own stages to ready and delivered, and the
 *      reports count it by phase.
 * Each vertical's spec file calls verticalPath(shop).
 */

const go = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
};

/**
 * A word as a word: «خياط» or «الخياط», not inside «خياطة» (sewing -- a
 * fabric store's own «إكسسوارات خياطة» is right for it).
 */
export function findWord(text: string, word: string): number {
  const re = new RegExp(`(^|[^\u0600-\u06FF])(و?(?:ال|بال|لل|كال)?)${word}(?=$|[^\u0600-\u06FF])`, 'u');
  const m = re.exec(text);
  return m ? m.index + m[1].length : -1;
}

/** The words on screen (the visible text, not the code). */
const screenText = (page: Page) => page.locator('body').innerText();

async function stageLabel(vertical: string, stageKey: string): Promise<string> {
  const { data, error } = await db().from('vertical_workflow_stages').select('label_ar').eq('vertical_key', vertical).eq('stage_key', stageKey).single();
  if (error || !data) throw new Error(`stage ${vertical}/${stageKey}: ${error?.message}`);
  return data.label_ar as string;
}

async function stageOfPhase(vertical: string, phase: string): Promise<string> {
  const { data } = await db().from('vertical_workflow_stages').select('stage_key').eq('vertical_key', vertical).eq('phase', phase).order('sort').limit(1);
  return (data?.[0]?.stage_key as string) ?? phase;
}

export function verticalPath(shop: VerticalShop): void {
  test.describe(`${shop.vertical}`, () => {
    test.describe.configure({ mode: 'serial' });

    test(`${shop.vertical}: no other vertical's words on its screens`, async ({ page }) => {
      test.setTimeout(180_000);
      await signInAs(page, shop.ownerEmail);
      const routes = ['/dashboard', '/inventory', '/customers', '/reports', '/settings', ...(shop.order ? ['/orders'] : [])];
      const found: string[] = [];
      for (const route of routes) {
        await go(page, route);
        const text = await screenText(page);
        for (const word of shop.forbiddenWords) {
          const at = findWord(text, word);
          if (at >= 0) found.push(`${route}: «${word}» in «${text.slice(Math.max(0, at - 25), at + word.length + 25).replace(/\s+/g, ' ')}»`);
        }
      }
      expect(found, 'words from another vertical').toEqual([]);
    });

    test(`${shop.vertical}: a sale in the POS issues its tax invoice`, async ({ page }) => {
      await signInAs(page, shop.ownerEmail);
      await page.goto('/sales');
      const openShift = page.getByRole('button', { name: 'تأكيد وفتح الوردية' });
      await page.getByRole('button', { name: 'نقطة البيع (POS)' }).first().click();
      await openShift.waitFor({ timeout: 8_000 }).catch(() => page.getByRole('button', { name: 'بيع جديد' }).click());
      await openShift.click();
      const search = page.getByPlaceholder('ابحث عن منتج أو باركود...');
      await expect(search).toBeVisible();
      await search.fill(shop.pieceItem.name);
      await page.getByText(shop.pieceItem.name).first().click();
      await page.keyboard.press('F8');
      await page.keyboard.press('Control+1');
      await page.keyboard.press('F9');

      let orderId = '';
      await expect.poll(async () => {
        const { data } = await db().from('orders').select('id').eq('tenant_id', shop.tenantId).eq('kind', 'pos_sale');
        orderId = data?.[0]?.id ?? '';
        return data?.length ?? 0;
      }, { timeout: 20_000, message: 'the sale is saved' }).toBe(1);
      const { data: invoice } = await db().from('tax_invoices').select('invoice_hash').eq('order_id', orderId).single();
      expect(invoice?.invoice_hash, 'its tax invoice carries its hash').toBeTruthy();
      const { data: stock } = await db().from('branch_inventory').select('quantity').eq('item_id', shop.pieceItem.id).single();
      expect(Number(stock!.quantity)).toBe(shop.pieceItem.stock - 1);
    });

    if (shop.order) {
      const order = shop.order;
      test(`${shop.vertical}: an order goes through its stages to delivered`, async ({ page }) => {
        test.setTimeout(150_000);
        const readyKey = await stageOfPhase(shop.vertical, 'ready');
        const deliveredKey = await stageOfPhase(shop.vertical, 'delivered');
        const [first, middle, ready, delivered] = await Promise.all([
          stageLabel(shop.vertical, order.firstStage),
          stageLabel(shop.vertical, order.stages[0]),
          stageLabel(shop.vertical, readyKey),
          stageLabel(shop.vertical, deliveredKey),
        ]);
        const statusKey = async () => (await db().from('orders').select('status_key').eq('id', order.id).single()).data?.status_key;

        await signInAs(page, shop.ownerEmail);
        await go(page, '/orders');
        await page.getByRole('button', { name: 'التفاصيل' }).first().click();
        const details = page.getByRole('dialog', { name: 'تفاصيل الطلب' });

        // Its second stage: the reports count it "in progress", not "received".
        await details.getByRole('button', { name: first }).click();
        await page.getByRole('option', { name: middle }).click();
        const materials = page.getByRole('dialog', { name: /خصم/ });
        if (await materials.isVisible().catch(() => false)) await materials.getByRole('button', { name: /نقل الطلب/ }).click();
        await expect.poll(statusKey, { timeout: 20_000, message: `moved to ${order.stages[0]}` }).toBe(order.stages[0]);

        await details.getByRole('button', { name: middle }).click();
        await page.getByRole('option', { name: ready }).click();
        if (await materials.isVisible().catch(() => false)) await materials.getByRole('button', { name: /نقل الطلب/ }).click();
        await expect.poll(statusKey, { timeout: 20_000, message: 'ready' }).toBe(readyKey);
        // "Tell the customer it's ready?" -- not now; then back to the order.
        const readyPrompt = page.getByRole('dialog').filter({ hasText: 'الطلب جاهز' });
        if (await readyPrompt.waitFor({ timeout: 8_000 }).then(() => true, () => false)) {
          await readyPrompt.getByRole('button', { name: 'إغلاق' }).click();
          await readyPrompt.waitFor({ state: 'hidden', timeout: 8_000 });
        }
        if (!(await details.waitFor({ timeout: 3_000 }).then(() => true, () => false))) {
          await page.getByRole('button', { name: 'التفاصيل' }).first().click();
        }

        await details.getByRole('button', { name: ready }).click();
        await page.getByRole('option', { name: delivered }).click();
        // Paid in full: the app asks to confirm the delivery.
        await page.getByRole('dialog', { name: 'تأكيد تسليم الطلب' }).getByRole('button', { name: 'تأكيد التسليم' }).click();
        await expect.poll(statusKey, { timeout: 20_000, message: 'delivered' }).toBe(deliveredKey);
      });
    }
  });
}
