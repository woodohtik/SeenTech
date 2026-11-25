// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readTenantRow = vi.fn();
vi.mock('./tenantRow', () => ({ readTenantRow: (id: string) => readTenantRow(id), forgetTenantRow: vi.fn() }));

import {
  DEFAULT_INVOICE_LAYOUT,
  INVOICE_LAYOUT_CACHE_KEY,
  __resetInvoiceLayoutForTests,
  allocateInvoiceLines,
  getInvoiceLayout,
  normalizeInvoiceLayout,
  paperSizeFromLayout,
  refreshInvoiceLayout,
  setInvoiceLayoutTenant,
} from './invoiceLayout';

// seen-invoice-layout-settings-task.md

beforeEach(() => {
  localStorage.clear();
  readTenantRow.mockReset();
  __resetInvoiceLayoutForTests();
});
afterEach(() => vi.useRealTimers());

describe('normalizeInvoiceLayout', () => {
  it('fills every field from the defaults, whatever was stored', () => {
    expect(normalizeInvoiceLayout(null)).toEqual(DEFAULT_INVOICE_LAYOUT);
    const n = normalizeInvoiceLayout({ header: { alignment: 'right' }, footer: { thankYouMessage: 'أهلاً' } });
    expect(n.header.alignment).toBe('right');
    expect(n.header.logoBorder).toBe(true);
    expect(n.footer.thankYouMessage).toBe('أهلاً');
    expect(n.columns.showUnitPrice).toBe(true);
  });

  it('drops the removed options (design template, QR switch) without errors', () => {
    const n = normalizeInvoiceLayout({ layoutTemplate: 'detailed', footer: { showZatcaQr: false } }) as unknown as Record<string, unknown>;
    expect(n.layoutTemplate).toBeUndefined();
    expect((n.footer as Record<string, unknown>).showZatcaQr).toBeUndefined();
  });

  it('keeps unknown or broken values from breaking the print', () => {
    const n = normalizeInvoiceLayout({ printSize: 'letter', header: { alignment: 'diagonal', logoUrl: 5 }, columns: 'x' });
    expect(n.printSize).toBe('thermal80');
    expect(n.header.alignment).toBe('center');
    expect(n.header.logoUrl).toBe('');
    expect(n.columns).toEqual(DEFAULT_INVOICE_LAYOUT.columns);
  });

  it('cuts the return policy to 200 characters and the thanks to 60 (question 4)', () => {
    const n = normalizeInvoiceLayout({ footer: { returnPolicy: 'س'.repeat(250), thankYouMessage: 'ش'.repeat(90) } });
    expect(n.footer.returnPolicy).toHaveLength(200);
    expect(n.footer.thankYouMessage).toHaveLength(60);
  });
});

describe('one source: the shop row, the browser only a cache', () => {
  it('a device with a cleared browser prints with the shop settings once the row is read', async () => {
    readTenantRow.mockResolvedValue({ data: { invoice_settings: { footer: { thankYouMessage: 'نسعد بخدمتك', returnPolicy: 'الاستبدال خلال 7 أيام' }, header: { logoUrl: 'https://x/logo.png' } }, tax_settings: { vatRate: 15 } }, error: null });
    expect(getInvoiceLayout().footer.thankYouMessage).toBe(DEFAULT_INVOICE_LAYOUT.footer.thankYouMessage);
    setInvoiceLayoutTenant('t1');
    await vi.waitFor(() => expect(getInvoiceLayout().footer.thankYouMessage).toBe('نسعد بخدمتك'));
    expect(getInvoiceLayout().header.logoUrl).toBe('https://x/logo.png');
    // The cache now holds it, for printing offline.
    expect(JSON.parse(localStorage.getItem(INVOICE_LAYOUT_CACHE_KEY)!).footer.returnPolicy).toBe('الاستبدال خلال 7 أيام');
  });

  it('offline, the last cached copy is used', () => {
    localStorage.setItem(INVOICE_LAYOUT_CACHE_KEY, JSON.stringify({ footer: { thankYouMessage: 'من الذاكرة' } }));
    __resetInvoiceLayoutForTests();
    expect(getInvoiceLayout().footer.thankYouMessage).toBe('من الذاكرة');
  });

  it('a failed read keeps the cached copy', async () => {
    localStorage.setItem(INVOICE_LAYOUT_CACHE_KEY, JSON.stringify({ footer: { thankYouMessage: 'من الذاكرة' } }));
    __resetInvoiceLayoutForTests();
    readTenantRow.mockResolvedValue({ data: null, error: { message: 'offline' } });
    setInvoiceLayoutTenant('t1');
    await refreshInvoiceLayout();
    expect(getInvoiceLayout().footer.thankYouMessage).toBe('من الذاكرة');
  });

  it('a change saved on another device arrives when the tab comes back (at most once a minute)', async () => {
    readTenantRow.mockResolvedValueOnce({ data: { invoice_settings: { footer: { thankYouMessage: 'أول' } } }, error: null });
    setInvoiceLayoutTenant('t1');
    await vi.waitFor(() => expect(getInvoiceLayout().footer.thankYouMessage).toBe('أول'));
    readTenantRow.mockResolvedValue({ data: { invoice_settings: { footer: { thankYouMessage: 'ثاني' } } }, error: null });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.useRealTimers();
    await vi.waitFor(() => expect(getInvoiceLayout().footer.thankYouMessage).toBe('ثاني'));
  });

  it('the shop VAT rate comes from its tax settings', async () => {
    readTenantRow.mockResolvedValue({ data: { invoice_settings: {}, tax_settings: { vatRate: 15 } }, error: null });
    setInvoiceLayoutTenant('t1');
    await vi.waitFor(() => expect(getInvoiceLayout().shopVatRate).toBe(0.15));
  });
});

describe('paperSizeFromLayout: the order (task file 2.3)', () => {
  it('a B2B tax invoice is A4; else the printer setting; else the layout size; else 80mm', () => {
    expect(paperSizeFromLayout({ isB2B: true, printerSize: '58mm', layoutSize: 'thermal58' })).toBe('A4');
    expect(paperSizeFromLayout({ isB2B: false, printerSize: '58mm', layoutSize: 'a4' })).toBe('58mm');
    expect(paperSizeFromLayout({ isB2B: false, printerSize: null, layoutSize: 'thermal58' })).toBe('58mm');
    expect(paperSizeFromLayout({ isB2B: false, printerSize: null, layoutSize: 'a5' })).toBe('A5');
    expect(paperSizeFromLayout({ isB2B: false, printerSize: null, layoutSize: undefined })).toBe('80mm');
  });
});

// Task file phase 3: 350, a 20 discount, 15% VAT.
describe('allocateInvoiceLines: VAT per line with a discount', () => {
  it('each line shows 15%, and the lines add up to the invoice VAT (49.50)', () => {
    const lines = allocateInvoiceLines(
      [{ unitPrice: 350, quantity: 1, taxType: 'exclusive' }],
      { subtotal: 350, discount: 20, vatAmount: 49.5 },
      0.15,
    );
    expect(lines[0].vatRate).toBe(0.15);
    expect(lines[0].taxable).toBe(330);
    expect(lines[0].vat).toBe(49.5);
    expect(lines[0].total).toBe(379.5);
  });

  it('spreads the discount over lines by their amounts; rounding goes to the last line', () => {
    const lines = allocateInvoiceLines(
      [
        { unitPrice: 100, quantity: 1, taxType: 'exclusive' },
        { unitPrice: 200, quantity: 1, taxType: 'exclusive' },
        { unitPrice: 33.33, quantity: 3, taxType: 'exclusive' },
      ],
      { subtotal: 399.99, discount: 10, vatAmount: 58.5 },
      0.15,
    );
    const vatSum = Math.round(lines.reduce((s, l) => s + l.vat, 0) * 100) / 100;
    const taxableSum = Math.round(lines.reduce((s, l) => s + l.taxable, 0) * 100) / 100;
    expect(vatSum).toBe(58.5);
    expect(taxableSum).toBe(389.99);
    for (const l of lines) expect(l.vatRate).toBe(0.15);
  });

  it('an exempt line carries no VAT and never moves the rate', () => {
    const lines = allocateInvoiceLines(
      [{ unitPrice: 100, quantity: 1, taxType: 'exclusive' }, { unitPrice: 50, quantity: 1, taxType: 'exempt' }],
      { subtotal: 150, discount: 0, vatAmount: 15 },
      0.15,
    );
    expect(lines[0].vat).toBe(15);
    expect(lines[1].vat).toBe(0);
    expect(lines[1].vatRate).toBe(0);
    expect(lines[0].vatRate).toBe(0.15);
  });

  it('without a discount, a line is exactly what it was', () => {
    const [line] = allocateInvoiceLines([{ unitPrice: 115, quantity: 2, taxType: 'inclusive' }], { subtotal: 200, discount: 0, vatAmount: 30 }, 0.15);
    expect(line).toMatchObject({ base: 200, taxable: 200, vat: 30, total: 230 });
  });
});
