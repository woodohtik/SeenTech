// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ar' } }),
}));
vi.mock('../../lib/direction', () => ({ useDirection: () => ({ dir: 'rtl', isRtl: true }) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('../../lib/pushNotifications', () => ({ subscribeToOrderNotifications: vi.fn() }));
vi.mock('../../lib/trackedOrders', () => ({ addTrackingToken: vi.fn() }));
vi.mock('../../lib/pushNotificationsCapacitorCustomer', () => ({ reRegisterPushForTrackedOrders: vi.fn() }));
vi.mock('../../lib/apiBase', () => ({ apiUrl: (p: string) => p }));

import OrderTracking from './OrderTracking';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function respond(body: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
}

// seen-verticals-readiness-task.md Phase 2: the customer sees the shop's
// own stages, not the tailoring steps.
test("a furniture order shows the furniture stages, not the tailoring steps", async () => {
  respond({
    order_number: 7, status: 'upholstery', shop_name: 'معرض', delivery_date: null, phase: 'in_progress',
    stages: [
      { key: 'order_received', phase: 'received', label_ar: 'استلام الطلب' },
      { key: 'upholstery', phase: 'in_progress', label_ar: 'تنجيد' },
      { key: 'ready', phase: 'ready', label_ar: 'جاهز للتسليم' },
      { key: 'delivered', phase: 'delivered', label_ar: 'تم التسليم' },
    ],
  });
  render(<OrderTracking token="t" />);
  expect(await screen.findByText('تنجيد')).toBeTruthy();
  expect(screen.getByText('جاهز للتسليم')).toBeTruthy();
  expect(screen.queryByText('public_tracking.step_cutting')).toBeNull();
  expect(screen.queryByText('public_tracking.step_sewing')).toBeNull();
});

test("a men's tailoring order keeps the fixed steps", async () => {
  respond({ order_number: 3, status: 'sewing', shop_name: 'خياط', delivery_date: null });
  render(<OrderTracking token="t" />);
  expect(await screen.findByText('public_tracking.step_cutting')).toBeTruthy();
  expect(screen.getByText('public_tracking.step_sewing')).toBeTruthy();
  expect(screen.getByText('public_tracking.step_received')).toBeTruthy();
});
