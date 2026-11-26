import { expect, test } from '@playwright/test';
import { db } from './db';
import { SHOP, STAFF } from './fixtures';
import { signIn } from './helpers';

// Golden path 3 (seen-merchant-trial-test-2026-11-26.md, phase 1): the shop
// owner adds a tailor from Settings > Staff. It failed with "no permission"
// and left a half-made sign-in account behind -- checked in the database.

const NEW_TAILOR = { name: 'خياط جديد', email: 'new.tailor@golden.test', phone: '0500000009' };

async function openAddForm(page: import('@playwright/test').Page) {
  await page.goto('/settings?tab=staff');
  await page.getByRole('button', { name: 'إضافة موظف' }).first().click();
  await expect(page.getByRole('heading', { name: 'إضافة موظف جديد' })).toBeVisible();
}

async function pick(page: import('@playwright/test').Page, placeholder: string, option: RegExp) {
  await page.getByRole('button', { name: placeholder }).click();
  await page.getByRole('option', { name: option }).first().click();
}

test("the owner can't add their own email as an employee", async ({ page }) => {
  await signIn(page, 'owner');
  await openAddForm(page);
  await page.getByLabel('الاسم الكامل').fill('نسخة المالك');
  await pick(page, 'اختر الدور...', /خياط/);
  await pick(page, 'اختر الفرع...', /الفرع الرئيسي/);
  await page.getByPlaceholder('user@example.com').fill(STAFF.owner.email);
  await page.getByPlaceholder('••••••••').last().fill('Another-Pass-1');
  await page.getByPlaceholder('+966500000000').fill('0500000008');
  await page.getByRole('button', { name: 'تأكيد الإضافة' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'هذا بريدك أنت' })).toBeVisible();
});

test('the owner adds a tailor: one sign-in account, one staff row', async ({ page }) => {
  await signIn(page, 'owner');
  await openAddForm(page);
  await page.getByLabel('الاسم الكامل').fill(NEW_TAILOR.name);
  await pick(page, 'اختر الدور...', /خياط/);
  await pick(page, 'اختر الفرع...', /الفرع الرئيسي/);
  await page.getByPlaceholder('user@example.com').fill(NEW_TAILOR.email);
  await page.getByPlaceholder('••••••••').last().fill('New-Tailor-Pass-1');
  await page.getByPlaceholder('+966500000000').fill(NEW_TAILOR.phone);
  await page.getByRole('button', { name: 'تأكيد الإضافة' }).click();
  await expect(page.getByRole('heading', { name: 'إضافة موظف جديد' })).toBeHidden({ timeout: 20_000 });

  const { data: staff } = await db().from('staff').select('id, uid, role, branch_id').eq('tenant_id', SHOP.tenantId).eq('email', NEW_TAILOR.email);
  expect(staff, 'one staff row for the new tailor').toHaveLength(1);
  expect(staff![0].role).toBe('tailor');
  expect(staff![0].branch_id).toBe(SHOP.branchId);
  const { data: users } = await db().from('users').select('id, display_name').eq('id', staff![0].uid);
  expect(users?.[0]?.display_name).toBe(NEW_TAILOR.name);
});

// Phase 2 item 1: a tailor with no email -- a PIN and a commission, no sign-in account.
test('the owner adds a PIN-only tailor with a 10% commission', async ({ page }) => {
  await signIn(page, 'owner');
  await openAddForm(page);
  await page.getByLabel('الاسم الكامل').fill('خياط بالرمز');
  await pick(page, 'اختر الدور...', /خياط/);
  await pick(page, 'اختر الفرع...', /الفرع الرئيسي/);
  await page.getByPlaceholder('+966500000000').fill('0500000007');
  await page.getByPlaceholder('****').fill('4826');
  await page.getByRole('radio', { name: 'نسبة من الطلب' }).click();
  await page.getByPlaceholder('0', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'تأكيد الإضافة' }).click();
  await expect(page.getByRole('heading', { name: 'إضافة موظف جديد' })).toBeHidden({ timeout: 20_000 });

  const { data: staff } = await db().from('staff').select('uid, email, role, pin_hash, commission_type, commission_value').eq('tenant_id', SHOP.tenantId).eq('name', 'خياط بالرمز');
  expect(staff, 'one staff row').toHaveLength(1);
  expect(staff![0]).toMatchObject({ uid: null, email: null, role: 'tailor', commission_type: 'percentage' });
  expect(Number(staff![0].commission_value)).toBe(10);
  expect(staff![0].pin_hash, 'the PIN is kept, hashed').toBeTruthy();
});
