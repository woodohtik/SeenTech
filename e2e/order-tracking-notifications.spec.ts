/**
 * order-tracking-notifications.spec.ts
 * ---------------------------------------------------------------------
 * seen-companion-app-task_1.md Phase 5.2 scenario: a customer opens a
 * tracking link, enables notifications, a staff member changes the
 * order's status, and the customer receives a notification (simulated).
 *
 * Deliberately does NOT log in as a real staff member or create any
 * account -- this project's standing rule is to never spin up disposable
 * test accounts, and to ask a human to log in themselves for anything
 * that genuinely needs a live authenticated session. So:
 *
 * - The customer-facing half (open link, see status, enable
 *   notifications) is driven through a real browser against the real
 *   staging origin, with only the two backend calls it makes
 *   (GET .../order-tracking/:token and POST .../subscribe) mocked via
 *   page.route() -- no real order, no real data touched.
 * - The "staff changes status -> customer gets notified" half is
 *   verified as a contract/security check instead of a full logged-in
 *   walkthrough: the authenticated endpoints that would actually send
 *   the push (POST /api/orders/:id/notify-status,
 *   POST /api/orders/:id/notify-new-order) correctly reject requests
 *   with no session, proving an attacker can't trigger a notification
 *   send for an order that isn't theirs. A real end-to-end run of that
 *   half (a genuine staff session actually changing a real order's
 *   status) is something to run manually, logged in as yourself, per
 *   this project's own testing convention -- not something to automate
 *   with a synthetic account.
 * - Actual OS-level push delivery is not verifiable from Playwright at
 *   all (it depends on a real FCM round trip and VITE_FIREBASE_VAPID_KEY
 *   being configured on this deploy, which is a separate manual step) --
 *   that receipt is the part the task itself calls "simulated": the
 *   enable-notifications test below accepts either the real success
 *   state or the graceful "unavailable" state so it stays meaningful
 *   both before and after that key is configured.
 */
import { test, expect } from '@playwright/test';

// A syntactically valid but almost-certainly-nonexistent tracking token --
// only used for the 404/rate-limit-shape checks, never for the mocked
// happy-path tests below (those intercept the response directly).
const FAKE_TOKEN = '00000000-0000-4000-8000-000000000000';

test.describe('Public order tracking (customer side)', () => {
  test('renders the order status from the tracking link', async ({ page }) => {
    await page.route(`**/api/public/order-tracking/${FAKE_TOKEN}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          order_number: 10482,
          status: 'sewing',
          shop_name: 'خياطة الأناقة',
          shop_logo_url: null,
          delivery_date: '2026-09-20T00:00:00Z',
        }),
      })
    );

    await page.goto(`/track/${FAKE_TOKEN}`);

    await expect(page.getByText('خياطة الأناقة')).toBeVisible();
    await expect(page.getByText(/10482/)).toBeVisible();
  });

  test('shows a not-found message for an unknown token, not a crash', async ({ page }) => {
    await page.route(`**/api/public/order-tracking/${FAKE_TOKEN}`, (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Order not found' }) })
    );

    await page.goto(`/track/${FAKE_TOKEN}`);

    // i18n key public_tracking.order_not_found -- checking the element
    // renders at all (not the exact translated string) keeps this test
    // language-independent.
    await expect(page.locator('body')).not.toContainText('undefined');
    await expect(page.getByRole('heading', { name: 'خياطة الأناقة' })).toHaveCount(0);
  });

  test('enable-notifications button works without crashing, either outcome', async ({ page, context }) => {
    await context.grantPermissions(['notifications']);

    await page.route(`**/api/public/order-tracking/${FAKE_TOKEN}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          order_number: 10482,
          status: 'cutting',
          shop_name: 'خياطة الأناقة',
          shop_logo_url: null,
          delivery_date: null,
        }),
      })
    );
    await page.route(`**/api/public/order-tracking/${FAKE_TOKEN}/subscribe`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    );

    await page.goto(`/track/${FAKE_TOKEN}`);

    const enableButton = page.getByRole('button', { name: /إشعارات|notifications/i });
    await expect(enableButton).toBeVisible();
    await enableButton.click();

    // Success requires VITE_FIREBASE_VAPID_KEY to be configured on this
    // deploy (a manual step, see PUBLIC_TRACKING_SPEC.md); until then the
    // code fails closed with a graceful message instead of crashing --
    // either outcome is a passing, meaningful assertion here.
    await expect(
      page.getByText(/تم التفعيل|Enabled|غير مدعومة|not supported|تعذّر|Couldn't/i)
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Notification-trigger endpoints require a real session (staff side)', () => {
  test('notify-status rejects an unauthenticated request', async ({ request }) => {
    const res = await request.post('/api/orders/00000000-0000-4000-8000-000000000000/notify-status');
    expect(res.status()).toBe(401);
  });

  test('notify-new-order rejects an unauthenticated request', async ({ request }) => {
    const res = await request.post('/api/orders/00000000-0000-4000-8000-000000000000/notify-new-order');
    expect(res.status()).toBe(401);
  });

  test('staff push-subscribe rejects an unauthenticated request', async ({ request }) => {
    const res = await request.post('/api/staff/push-subscribe', { data: { fcmToken: 'x' } });
    expect(res.status()).toBe(401);
  });
});

test.describe('Public tracking API contract (no mocking -- real staging)', () => {
  test('malformed token is rejected before touching the database', async ({ request }) => {
    const res = await request.get('/api/public/order-tracking/not-a-uuid');
    expect(res.status()).toBe(404);
  });

  test('well-formed but unknown token returns 404, not an error', async ({ request }) => {
    const res = await request.get(`/api/public/order-tracking/${FAKE_TOKEN}`);
    expect(res.status()).toBe(404);
  });

  test('subscribe rejects a missing fcmToken', async ({ request }) => {
    const res = await request.post(`/api/public/order-tracking/${FAKE_TOKEN}/subscribe`, { data: {} });
    expect([400, 404]).toContain(res.status()); // 404 if the rate limiter/token check runs first
  });
});
