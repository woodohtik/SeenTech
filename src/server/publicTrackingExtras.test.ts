import { expect, test } from 'vitest';
import { publicTrackingExtras } from './publicTrackingExtras';

// seen-merchant-trial-test-2026-11-26.md, phase 2 item 5: the tracking page
// had no amount left to pay, no way to call the shop or find it.

test('the amount left, the shop phone and a map link', () => {
  const out = publicTrackingExtras(
    { total_amount: 115, paid_amount: 50, remaining_amount: 65 },
    { phone: '0110000000', address: 'حي النخيل', city: 'الرياض' },
  );
  expect(out).toEqual({
    remaining_amount: 65,
    shop_phone: '0110000000',
    shop_address: 'حي النخيل، الرياض',
    shop_map_url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('حي النخيل، الرياض'),
  });
});

test('worked out from total and paid when the column is empty; never below zero', () => {
  expect(publicTrackingExtras({ total_amount: 100, paid_amount: 120, remaining_amount: null }, {}).remaining_amount).toBe(0);
  expect(publicTrackingExtras({ total_amount: 100, paid_amount: 40 }, {}).remaining_amount).toBe(60);
});

test('no phone or address: nothing invented', () => {
  expect(publicTrackingExtras({ total_amount: 0 }, null)).toEqual({ remaining_amount: 0, shop_phone: null, shop_address: null, shop_map_url: null });
});
