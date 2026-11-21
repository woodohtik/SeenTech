/**
 * seen-verticals-readiness-task.md Phase 8: the customer's tracking page for
 * every activity, against the real staging origin. Following
 * e2e/order-tracking-notifications.spec.ts: no account is created and no one
 * logs in -- the one backend call the page makes is answered with page.route(),
 * shaped exactly as server.ts returns it for a shop on that activity (its own
 * stages, names, phase; nothing extra for men's tailoring).
 *
 * The logged-in walk (register -> pick the activity -> item -> sale -> order
 * through every stage -> payment -> delivery) is covered in the database by
 * supabase/tests/verticals_order_flow_test.sql, and by hand on staging, per
 * this project's rule against synthetic accounts.
 */
import { test, expect } from '@playwright/test';

const TOKEN = '00000000-0000-4000-8000-0000000000aa';

type Stage = { key: string; phase: 'received' | 'in_progress' | 'ready' | 'delivered'; label_ar: string };

// The stages of each activity as vertical_workflow_stages holds them (20261231000001).
const ACTIVITIES: Record<string, { current: string; stages: Stage[] }> = {
  womens_tailoring: {
    current: 'fitting',
    stages: [
      { key: 'measurements_taken', phase: 'received', label_ar: 'تم أخذ المقاسات' },
      { key: 'cutting', phase: 'in_progress', label_ar: 'قص' },
      { key: 'sewing', phase: 'in_progress', label_ar: 'خياطة' },
      { key: 'embroidery', phase: 'in_progress', label_ar: 'تطريز' },
      { key: 'fitting', phase: 'in_progress', label_ar: 'بروفة/قياس' },
      { key: 'ironing_packaging', phase: 'in_progress', label_ar: 'كي وتغليف' },
      { key: 'ready', phase: 'ready', label_ar: 'جاهز' },
      { key: 'delivered', phase: 'delivered', label_ar: 'تم التسليم' },
    ],
  },
  furniture: {
    current: 'upholstery',
    stages: [
      { key: 'order_received', phase: 'received', label_ar: 'استلام الطلب' },
      { key: 'design_approval', phase: 'in_progress', label_ar: 'اعتماد التصميم' },
      { key: 'frame_building', phase: 'in_progress', label_ar: 'تجهيز الهيكل' },
      { key: 'upholstery', phase: 'in_progress', label_ar: 'تنجيد' },
      { key: 'finishing', phase: 'in_progress', label_ar: 'تشطيب' },
      { key: 'quality_check', phase: 'in_progress', label_ar: 'فحص الجودة' },
      { key: 'ready', phase: 'ready', label_ar: 'جاهز للتسليم' },
      { key: 'delivered', phase: 'delivered', label_ar: 'تم التسليم' },
    ],
  },
  fabric_store: {
    current: 'ready_pickup',
    stages: [
      { key: 'order_received', phase: 'received', label_ar: 'استلام الطلب' },
      { key: 'cutting_measuring', phase: 'in_progress', label_ar: 'قص وقياس بالمتر' },
      { key: 'ready_pickup', phase: 'ready', label_ar: 'جاهز للاستلام' },
      { key: 'delivered', phase: 'delivered', label_ar: 'تم التسليم' },
    ],
  },
  specialty_clothing: {
    current: 'printing_embroidery',
    stages: [
      { key: 'order_received', phase: 'received', label_ar: 'استلام الطلب' },
      { key: 'design_approval', phase: 'in_progress', label_ar: 'اعتماد التصميم/الشعار' },
      { key: 'cutting', phase: 'in_progress', label_ar: 'قص' },
      { key: 'sewing', phase: 'in_progress', label_ar: 'خياطة' },
      { key: 'printing_embroidery', phase: 'in_progress', label_ar: 'طباعة/تطريز الشعار' },
      { key: 'quality_check', phase: 'in_progress', label_ar: 'فحص الجودة' },
      { key: 'ready', phase: 'ready', label_ar: 'جاهز' },
      { key: 'delivered', phase: 'delivered', label_ar: 'تم التسليم' },
    ],
  },
};

for (const [activity, { current, stages }] of Object.entries(ACTIVITIES)) {
  test(`${activity}: the tracking page shows the shop's own stages`, async ({ page }) => {
    await page.route(`**/api/public/order-tracking/${TOKEN}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          order_number: 501, status: current, shop_name: 'محل اختبار', shop_logo_url: null, delivery_date: null,
          phase: stages.find((s) => s.key === current)!.phase,
          stages: stages.map((s) => ({ ...s, label_en: null, label_ur: null })),
        }),
      }),
    );
    await page.goto(`/track/${TOKEN}`);
    for (const s of stages) await expect(page.getByText(s.label_ar, { exact: true })).toBeVisible();
    // No raw stage key on the page.
    await expect(page.getByText(current, { exact: true })).toHaveCount(0);
  });
}

test("mens_tailoring: the tracking page keeps its fixed steps", async ({ page }) => {
  await page.route(`**/api/public/order-tracking/${TOKEN}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ order_number: 502, status: 'sewing', shop_name: 'خياط', shop_logo_url: null, delivery_date: null }),
    }),
  );
  await page.goto(`/track/${TOKEN}`);
  // Five steps, as before (received, cutting, sewing, preparing, ready).
  await expect(page.locator('ol li')).toHaveCount(5);
});
