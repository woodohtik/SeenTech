// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// react-barcode draws on a canvas, which jsdom lacks: an svg stands in.
vi.mock('react-barcode', () => ({ default: ({ value }: { value: string }) => <svg data-barcode={value} /> }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'ar' } }),
}));
vi.mock('../../lib/tenantRow', () => ({ readTenantRow: vi.fn(), forgetTenantRow: vi.fn() }));

import SimplifiedTaxInvoice from './SimplifiedTaxInvoice';
import TaxInvoice from './TaxInvoice';
import { DEFAULT_INVOICE_LAYOUT, type InvoiceLayoutState } from '../../lib/invoiceLayout';

// seen-invoice-layout-settings-task.md: every option left on the screen
// changes the real print, and a discount no longer bends the VAT per line.

afterEach(cleanup);

const layoutWith = (over: { header?: object; columns?: object; footer?: object } = {}): InvoiceLayoutState => ({
  ...DEFAULT_INVOICE_LAYOUT,
  shopVatRate: 0.15,
  header: { ...DEFAULT_INVOICE_LAYOUT.header, ...(over.header || {}) },
  columns: { ...DEFAULT_INVOICE_LAYOUT.columns, ...(over.columns || {}) },
  footer: { ...DEFAULT_INVOICE_LAYOUT.footer, ...(over.footer || {}) },
});

// Task file phase 3: 350, 20 off, 15% VAT.
const discounted = {
  invoiceNumber: 'INV-2026-00042',
  issueDate: '2026-11-25T10:00:00.000Z',
  paymentMethod: 'نقداً',
  seller: { name: 'مشغل', vatNumber: '300000000000003', address: 'الرياض' },
  customerName: 'عميل',
  items: [{ id: '1', name: 'ثوب', quantity: 1, unitPrice: 350, taxType: 'exclusive' as const }],
  totals: { subtotal: 350, discount: 20, taxableAmount: 330, vatAmount: 49.5, grandTotal: 379.5 },
  hidePrintButton: true,
};

const thermal = (layout: InvoiceLayoutState, extra: object = {}) =>
  render(<SimplifiedTaxInvoice {...discounted} layout={layout} vatRate={0.15} {...extra} />).container;
const a4 = (layout: InvoiceLayoutState, extra: object = {}) =>
  render(<TaxInvoice {...(discounted as any)} buyer={{ name: 'شركة', vatNumber: '300000000000003' }} supplyDate={discounted.issueDate} layout={layout} vatRate={0.15} {...extra} />).container;

describe('VAT per line with a discount', () => {
  it('A4: the line shows 15%, its taxable 330.00 and VAT 49.50 -- the invoice VAT', () => {
    const text = a4(layoutWith()).textContent!;
    expect(text).toContain('15%');
    expect(text).not.toContain('14%');
    expect(text).toContain('330.00');
    expect(text).toContain('49.50');
    expect(text).toContain('379.50');
  });

  it('thermal: the line breakdown is after its share of the discount', () => {
    const text = thermal(layoutWith()).textContent!;
    expect(text).toContain('قبل الضريبة: 330.00');
    expect(text).toContain('الضريبة: 49.50');
    expect(text).toContain('الضريبة (15%)');
  });
});

describe('the options print', () => {
  it('unit price column: on and off, on both papers', () => {
    expect(thermal(layoutWith()).textContent).toContain('السعر');
    cleanup();
    expect(thermal(layoutWith({ columns: { showUnitPrice: false } })).textContent).not.toContain('السعر');
    cleanup();
    expect(a4(layoutWith()).textContent).toContain('سعر الوحدة خاضع');
    cleanup();
    expect(a4(layoutWith({ columns: { showUnitPrice: false } })).textContent).not.toContain('سعر الوحدة خاضع');
  });

  it('barcode: the invoice number as a barcode, only when on', () => {
    expect(thermal(layoutWith()).querySelector('[data-testid="invoice-barcode"] svg')).not.toBeNull();
    cleanup();
    expect(thermal(layoutWith({ columns: { showBarcode: false } })).querySelector('[data-testid="invoice-barcode"]')).toBeNull();
    cleanup();
    expect(a4(layoutWith({ columns: { showBarcode: false } })).querySelector('[data-testid="invoice-barcode"]')).toBeNull();
  });

  it('thanks and return policy: the shop own text, on both papers; the default thanks when empty', () => {
    const custom = layoutWith({ footer: { thankYouMessage: 'نسعد بخدمتك دائماً', returnPolicy: 'الاستبدال خلال 7 أيام مع الفاتورة' } });
    const t = thermal(custom);
    expect(t.textContent).toContain('نسعد بخدمتك دائماً');
    expect(t.querySelector('[data-testid="invoice-return-policy"]')!.textContent).toContain('الاستبدال خلال 7 أيام');
    cleanup();
    const a = a4(custom);
    expect(a.textContent).toContain('نسعد بخدمتك دائماً');
    expect(a.textContent).toContain('الاستبدال خلال 7 أيام');
    cleanup();
    const none = thermal(layoutWith({ footer: { thankYouMessage: '', returnPolicy: '' } }));
    expect(none.textContent).toContain('شكراً لزيارتكم وعودتكم تسعدنا');
    expect(none.querySelector('[data-testid="invoice-return-policy"]')).toBeNull();
  });

  it('header alignment moves the shop name', () => {
    const right = thermal(layoutWith({ header: { alignment: 'right' } }));
    expect(right.querySelector('h2')!.parentElement!.className).toContain('text-right');
    cleanup();
    const left = thermal(layoutWith({ header: { alignment: 'left' } }));
    expect(left.querySelector('h2')!.parentElement!.className).toContain('text-left');
  });

  it('discount line: always on a tax invoice (its totals must add up); the switch hides it only on a receipt without VAT', () => {
    expect(thermal(layoutWith({ columns: { showDiscount: false } })).textContent).toContain('الخصم');
    cleanup();
    const noVat = { ...discounted.totals, vatAmount: 0, grandTotal: 330 };
    expect(thermal(layoutWith({ columns: { showDiscount: false } }), { totals: noVat, vatRate: 0 }).textContent).not.toContain('الخصم');
    cleanup();
    expect(thermal(layoutWith({ columns: { showDiscount: true } }), { totals: noVat, vatRate: 0 }).textContent).toContain('الخصم');
  });

  it('the logo comes from the layout', () => {
    const c = thermal(layoutWith({ header: { logoUrl: 'https://cdn.example/logo.png' } }));
    expect(c.querySelector('img')!.getAttribute('src')).toBe('https://cdn.example/logo.png');
  });
});

// P6 (MONEY-21) on A4 too: a line without a tax type of its own is read from
// the invoice's totals, not assumed to include VAT.
it('A4: a line with no tax type adds up to the invoice (330.00 taxable, 49.50 VAT)', () => {
  const items = [{ id: '1', name: 'ثوب', quantity: 1, unitPrice: 350 }];
  const text = render(
    <TaxInvoice {...(discounted as any)} items={items} buyer={{ name: 'شركة', vatNumber: '300000000000003' }} supplyDate={discounted.issueDate} layout={layoutWith()} vatRate={0.15} />,
  ).container.textContent!;
  expect(text).toContain('330.00');
  expect(text).toContain('49.50');
  expect(text).not.toContain('284.35');
});
