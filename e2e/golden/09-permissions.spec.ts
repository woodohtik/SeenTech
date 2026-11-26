import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

// Golden path 9 (seen-stability-guardrails-task.md, phase 1): a cashier and a
// tailor see only what their role allows -- and what is refused is refused
// out loud, never a silent success.

/** POST to the app's own API as the signed-in person (their session token). */
async function postAsMe(page: Page, url: string, body: unknown) {
  return page.evaluate(async ({ url, body }) => {
    const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
    const token = key ? JSON.parse(localStorage.getItem(key) || '{}').access_token : '';
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, { url, body });
}

test('a tailor: orders and customers only, no prices, settings refused', async ({ page }) => {
  await signIn(page, 'tailor');
  const nav = page.getByRole('navigation').first();
  await expect(nav.getByRole('link', { name: 'الطلبات' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'العملاء' })).toBeVisible();
  for (const hidden of ['المبيعات', 'المخزون', 'التقارير', 'الإعدادات', 'الموردين والمشتريات']) {
    await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);
  }
  await page.goto('/settings?tab=staff');
  await expect(page.getByRole('heading', { name: 'عفواً، لا تملك الصلاحية للوصول' })).toBeVisible();
  await page.goto('/orders');
  await expect(page.getByRole('heading', { name: 'الطلبات', level: 2 })).toBeVisible();
  await expect(page.getByText('إنشاء طلب جديد')).toHaveCount(0);

  // Refused out loud by the server, not just hidden on screen.
  const res = await postAsMe(page, '/api/staff/create', { name: 'دخيل', email: 'intruder@golden.test', password: 'Intruder-Pass-1', role: 'cashier' });
  expect(res.status, 'adding staff is refused').toBe(403);
  expect(res.body?.kind).toBe('permission');
});

test('a cashier: cannot add staff -- refused with a reason, not a silent success', async ({ page }) => {
  await signIn(page, 'cashier');
  await page.goto('/settings?tab=staff');
  await expect(page.getByRole('button', { name: 'إضافة موظف' })).toHaveCount(0);
  const res = await postAsMe(page, '/api/staff/create', { name: 'دخيل', email: 'intruder2@golden.test', password: 'Intruder-Pass-1', role: 'cashier' });
  expect(res.status).toBe(403);
  expect(res.body?.kind).toBe('permission');
});
