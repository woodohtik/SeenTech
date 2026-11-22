// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

// seen-readiness-fixes-task.md P4 (UX-14): the public invoice shows the
// order's own tax rate and the invoice's own QR, and a shop that is not
// tax-registered issues a receipt.
vi.mock('react-router-dom', () => ({ useParams: () => ({ id: 'o1' }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ar' } }) }));
vi.mock('../lib/supabase/client', () => ({ supabase: {} }));
vi.mock('../lib/direction', () => ({ useDirection: () => ({ t: (k: string) => k, dir: 'rtl' }) }));
vi.mock('../components/CurrencySymbol', () => ({ CurrencySymbol: () => null }));

import PublicInvoice from './PublicInvoice';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const answer = (tenant: any, invoice: any, order: any = {}) => vi.spyOn(global, 'fetch').mockResolvedValueOnce({
  ok: true,
  json: async () => ({
    order: { orderNumber: 7, orderDate: '2026-11-22T08:00:00Z', totalAmount: 105, vatAmount: 5, taxRatePercent: 5, items: [], ...order },
    invoice, tenant, customer: null,
  }),
} as any);

test('a registered shop: its rate (not a printed 15%) and its invoice QR', async () => {
  answer({ storeName: 'مشغل', vatNumber: '300000000000003', isTaxRegistered: true }, { invoiceNumber: 'INV-7', qr: 'AQRBQkNE' });
  const { container } = render(<PublicInvoice />);
  expect(await screen.findByText('فاتورة ضريبية مبسطة')).toBeTruthy();
  expect(screen.getByText('ضريبة القيمة المضافة (5%):')).toBeTruthy();
  expect(screen.queryByText(/\(15%\)/)).toBeNull();
  expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
});

test('a shop that is not tax-registered issues a receipt with no tax line and no QR', async () => {
  answer({ storeName: 'مشغل', vatNumber: null, isTaxRegistered: false }, null, { totalAmount: 100, vatAmount: 0, taxRatePercent: 0 });
  render(<PublicInvoice />);
  expect(await screen.findByText('إيصال')).toBeTruthy();
  expect(screen.queryByText('فاتورة ضريبية مبسطة')).toBeNull();
  expect(screen.queryByText(/ضريبة القيمة المضافة/)).toBeNull();
});
