// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'ar' } }),
}));

import SimplifiedTaxInvoice from './SimplifiedTaxInvoice';

// seen-readiness-fixes-task.md P3.2 (RELIABILITY-02): an offline sale with no
// reserved invoice number prints a provisional receipt -- never a tax invoice.
const props = {
  invoiceNumber: 'INV-501',
  issueDate: '2026-11-22T10:15:30.000Z',
  paymentMethod: 'نقداً',
  seller: { name: 'مشغل', vatNumber: '300000000000003', address: 'الرياض' },
  customerName: 'عميل',
  items: [{ id: 1, name: 'ثوب', quantity: 1, unitPrice: 115 }],
  totals: { subtotal: 100, vatAmount: 15, grandTotal: 115 },
  hidePrintButton: true,
} as any;

afterEach(cleanup);

const svgCount = (c: HTMLElement) => c.querySelectorAll('svg').length;

test('a provisional receipt says it is not a tax invoice and has no QR; a tax invoice has both', () => {
  const invoice = render(<SimplifiedTaxInvoice {...props} />);
  expect(screen.getByText('فاتورة ضريبية مبسطة')).toBeTruthy();
  const withQr = svgCount(invoice.container);
  cleanup();
  const receipt = render(<SimplifiedTaxInvoice {...props} provisional />);
  expect(screen.getByText('إيصال مؤقت — ليس فاتورة ضريبية')).toBeTruthy();
  expect(screen.queryByText('فاتورة ضريبية مبسطة')).toBeNull();
  expect(svgCount(receipt.container)).toBe(withQr - 1); // the QR is the one gone
});

// P6 (MONEY-21): the printed line total agrees with the server's total --
// a line priced before VAT is not printed as if VAT were inside it.
test('a line priced before VAT prints with its VAT, under the same total', () => {
  const { container } = render(
    <SimplifiedTaxInvoice
      {...props}
      items={[{ id: 1, name: 'ثوب', quantity: 1, unitPrice: 100 }]}
      totals={{ subtotal: 100, discount: 0, taxableAmount: 100, vatAmount: 15, grandTotal: 115 }}
    />,
  );
  const text = container.textContent || '';
  expect(text).toContain('115.00');
  expect(text).not.toContain('86.96'); // 100 / 1.15: the old "VAT is inside" reading of the line
});

test('a line priced with VAT inside still prints as it did', () => {
  const { container } = render(<SimplifiedTaxInvoice {...props} />); // 115, totals 100 / 15 / 115
  const text = container.textContent || '';
  expect(text).toContain('115.00');
  expect(text).not.toContain('132.25'); // 115 * 1.15
});
