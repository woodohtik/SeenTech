import { test, expect } from 'vitest';
import { buildPosInvoiceData } from './posInvoiceData';

// seen-merchant-trial-test-2026-11-26.md, phase 1: the simplified invoice
// came out as "تطبيق سين" (the platform's own branding), the seller as
// "النظام", and the branch as "الفرع الرئيسي" instead of the shop's own.

const ORDER = {
  invoiceNumber: 'INV-23', issuedAt: '2026-11-26T10:00:00Z', paymentMethod: 'cash',
  customerName: 'فيصل', items: [{ name: 'أزرار صدف', quantity: 10, price: 1 }],
  subTotal: 10, taxAmount: 1.5, discountAmount: 0, paidAmount: 11.5, total: 11.5, qrCode: 'qr', invoiceType: 'simplified',
};
const SHOP = { legalName: 'خياط الأناقة', trn: '310000000000003', address: 'الرياض - حي النخيل', phone: '0110000000' };

test("the invoice carries the shop's own name and address, never the platform's", () => {
  const data = buildPosInvoiceData(ORDER, { shop: SHOP, branchName: 'المعرض الرئيسي', staffName: 'صاحب المحل' })!;
  expect(data.seller.name).toBe('خياط الأناقة');
  expect(data.seller.name).not.toBe('تطبيق سين');
  expect(data.seller.address).toBe('الرياض - حي النخيل');
  expect(data.seller.vatNumber).toBe('310000000000003');
});

test('the real branch and the employee who issued it', () => {
  const data = buildPosInvoiceData(ORDER, { shop: SHOP, branchName: 'المعرض الرئيسي', staffName: 'صاحب المحل' })!;
  expect(data.branchName).toBe('المعرض الرئيسي');
  expect(data.sellerName).toBe('صاحب المحل');
});

test('nothing to print without a completed sale', () => {
  expect(buildPosInvoiceData(null, { shop: SHOP })).toBeNull();
});
