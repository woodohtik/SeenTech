// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));
vi.mock('../../lib/direction', () => ({ useDirection: () => ({ dir: 'rtl', isRtl: true }) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('../../lib/pushNotifications', () => ({ subscribeToOrderNotifications: vi.fn() }));
vi.mock('../../lib/trackedOrders', () => ({ addTrackingToken: vi.fn() }));
vi.mock('../../lib/pushNotificationsCapacitorCustomer', () => ({ reRegisterPushForTrackedOrders: vi.fn() }));
vi.mock('../../lib/apiBase', () => ({ apiUrl: (p: string) => p }));

import OrderTracking from './OrderTracking';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function respond(body: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
}

const inNineDays = new Date(Date.now() + 9 * 86400000).toISOString();

// seen-merchant-trial-test-2026-11-26.md, phase 2 item 5: a ready order kept
// saying "9 days left", with no amount left, phone or location.
test('a ready order says so plainly, not the days left', async () => {
  respond({ order_number: 7, status: 'ready', shop_name: 'خياط الأناقة', delivery_date: inNineDays, remaining_amount: 65, shop_phone: '0110000000', shop_map_url: 'https://www.google.com/maps/search/?api=1&query=x', shop_address: 'حي النخيل، الرياض' });
  render(<OrderTracking token="t" />);
  expect(await screen.findByText('public_tracking.ready_for_pickup')).toBeTruthy();
  expect(screen.queryByText('public_tracking.delivery_in_days')).toBeNull();
  expect(screen.getByText('public_tracking.remaining_amount')).toBeTruthy();
  expect(screen.getByRole('link', { name: /public_tracking.call_shop/ }).getAttribute('href')).toBe('tel:0110000000');
  expect(screen.getByRole('link', { name: /public_tracking.shop_location/ })).toBeTruthy();
  expect(document.title).toBe('public_tracking.page_title');
});

test('an order in work shows the days left and the date; nothing to pay shows no amount', async () => {
  respond({ order_number: 8, status: 'sewing', shop_name: 'خياط', delivery_date: inNineDays, remaining_amount: 0 });
  render(<OrderTracking token="t" />);
  expect(await screen.findByText('public_tracking.delivery_in_days')).toBeTruthy();
  expect(screen.getByText('public_tracking.delivery_on')).toBeTruthy();
  expect(screen.queryByText('public_tracking.ready_for_pickup')).toBeNull();
  expect(screen.queryByText('public_tracking.remaining_amount')).toBeNull();
  expect(screen.queryByRole('link', { name: /public_tracking.call_shop/ })).toBeNull();
});
