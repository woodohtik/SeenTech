import { expect, test } from '@playwright/test';
import { db } from './db';
import { CUSTOMER, FABRIC, SHOP } from './fixtures';
import { signIn } from './helpers';

// Golden path 11 (seen-order-images-upload-task.md): a phone-size photo with a
// GPS tag is added to an order; what is stored is WebP, at most 300 KB, with
// no EXIF left; the bucket is private (no public link); and abandoning the
// form leaves nothing behind.

test.use({ viewport: { width: 820, height: 1180 } });

/** A 3000x2250 JPEG drawn in the browser, with an EXIF (GPS) block put in after the start marker. */
async function phonePhotoWithGps(page: import('@playwright/test').Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 3000; c.height = 2250;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 4000; i++) { // varied content, so it does not compress to nothing
      g.fillStyle = `hsl(${(i * 37) % 360},60%,${30 + (i % 40)}%)`;
      g.fillRect((i * 97) % 3000, (i * 53) % 2250, 60 + (i % 90), 40 + (i % 70));
    }
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.95));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s);
  });
  const jpeg = Buffer.from(base64, 'base64');
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), Buffer.from('MM\0*\0\0\0\x08GPSLatitude 24.7136N GPSLongitude 46.6753E', 'binary')]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

test('a phone photo on a new order: small WebP, no EXIF, private', async ({ page }) => {
  test.setTimeout(150_000);
  const startedAt = new Date().toISOString();
  await signIn(page, 'owner');
  const photo = await phonePhotoWithGps(page);
  expect(photo.length, 'a phone-size photo to start with').toBeGreaterThan(1_000_000);
  expect(photo.includes(Buffer.from('GPSLatitude')), 'it carries a GPS tag').toBe(true);

  await page.goto('/orders');
  await page.getByText('إنشاء طلب جديد').first().click();
  const form = page.getByRole('dialog', { name: 'إنشاء طلب جديد' });
  await form.getByRole('button', { name: 'اختر عميل...' }).click();
  await page.getByRole('option', { name: CUSTOMER.name }).click();
  await form.getByRole('button', { name: /اختر التاريخ/ }).click();
  await page.getByRole('button', { name: 'اليوم' }).click();
  await form.getByRole('button', { name: 'اختر قماش...' }).click();
  await page.getByRole('option', { name: new RegExp(FABRIC.name) }).first().click();
  await form.getByRole('spinbutton', { name: 'سعر القطعة' }).fill('300');

  await form.getByTestId('order-images-input').setInputFiles({ name: 'IMG_0420.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(form.getByText(/\d+ ك\.ب/)).toBeVisible({ timeout: 60_000 }); // compressed, uploaded, its size shown
  await form.getByRole('button', { name: 'تأكيد وإنشاء الطلب' }).click();
  await expect(form).toBeHidden({ timeout: 20_000 });

  const { data: orders } = await db().from('orders').select('id, images').eq('tenant_id', SHOP.tenantId).gte('created_at', startedAt).order('created_at', { ascending: false }).limit(1);
  const order = orders?.[0];
  const path = (order?.images as string[] | undefined)?.[0] ?? '';
  expect(path, 'the order keeps a storage path').toMatch(new RegExp(`^${SHOP.tenantId}/${order?.id}/[0-9a-f-]{36}\\.webp$`));

  const { data: file, error } = await db().storage.from('order-images').download(path);
  expect(error, 'the file is in the bucket').toBeNull();
  const bytes = Buffer.from(await file!.arrayBuffer());
  expect(bytes.subarray(0, 4).toString('binary') + bytes.subarray(8, 12).toString('binary'), 'stored as WebP').toBe('RIFFWEBP');
  expect(bytes.length, `at most 300 KB (was ${Math.round(photo.length / 1024)} KB)`).toBeLessThanOrEqual(300 * 1024);
  expect(bytes.includes(Buffer.from('GPSLatitude')) || bytes.includes(Buffer.from('Exif')), 'no EXIF, no GPS').toBe(false);

  // Private: no public link opens it.
  const url = `${process.env.GOLDEN_SUPABASE_URL}/storage/v1/object/public/order-images/${path}`;
  const res = await page.request.get(url);
  expect(res.ok(), 'no public link').toBe(false);
});

test('abandoning the form takes its uploaded photo away again', async ({ page }) => {
  await signIn(page, 'owner');
  const before = await db().storage.from('order-images').list(SHOP.tenantId, { limit: 1000 });
  await page.goto('/orders');
  await page.getByText('إنشاء طلب جديد').first().click();
  const form = page.getByRole('dialog', { name: 'إنشاء طلب جديد' });
  const tiny = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==', 'base64');
  await form.getByTestId('order-images-input').setInputFiles({ name: 'tiny.jpg', mimeType: 'image/jpeg', buffer: tiny });
  await expect(form.getByText(/\d+ ك\.ب/)).toBeVisible({ timeout: 30_000 });
  await form.getByRole('button', { name: 'إغلاق' }).first().click();
  await expect.poll(async () => {
    const now = await db().storage.from('order-images').list(SHOP.tenantId, { limit: 1000 });
    return (now.data?.length ?? 0) - (before.data?.length ?? 0);
  }, { timeout: 20_000, message: 'no folder left behind' }).toBe(0);
});
