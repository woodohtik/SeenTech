import { describe, expect, it } from 'vitest';
import { subscriptionReceiptHtml, type ReceiptLabels } from './subscriptionReceipt';

// seen-readiness-fixes-task.md P5 (PLATFORM-06; founder question 7).
const L: ReceiptLabels = {
  title: 'إيصال اشتراك', notTaxInvoice: 'هذا إيصال استلام لرسوم الاشتراك، وليس فاتورة ضريبية.', receiptNo: 'رقم الإيصال',
  date: 'التاريخ', shop: 'المحل', plan: 'الباقة', period: 'الفترة', method: 'الطريقة', reference: 'المرجع',
  discount: 'الخصم', total: 'المبلغ المدفوع', issuer: 'سِين',
};
const p = {
  id: 'x', receipt_number: 'SUB-000042', plan_name: 'الخطة الأساسية', amount: 899.1, original_amount: 999, discount_amount: 99.9,
  payment_method: 'bank_transfer', reference: 'TRX-1', period_start: '2026-11-23T00:00:00Z', period_end: '2027-11-23T00:00:00Z',
  created_at: '2026-11-23T10:00:00Z',
};

describe('the subscription receipt', () => {
  it('says it is not a tax invoice, and carries no VAT line', () => {
    const html = subscriptionReceiptHtml(p, { shopName: 'محل', locale: 'ar-SA', dir: 'rtl', labels: L, methodLabel: 'تحويل' });
    expect(html).toContain('وليس فاتورة ضريبية');
    expect(html).not.toMatch(/ضريبة القيمة المضافة|VAT|الرقم الضريبي|15%/);
    expect(html).not.toContain('معتمد');
  });

  it('shows the receipt number, what was paid and the discount, to the halala', () => {
    const html = subscriptionReceiptHtml(p, { shopName: 'محل', locale: 'en', dir: 'ltr', labels: L, methodLabel: 'Bank' });
    expect(html).toContain('SUB-000042');
    expect(html).toContain('899.10 SAR');
    expect(html).toContain('99.90 SAR');
  });

  it('escapes what the shop typed', () => {
    const html = subscriptionReceiptHtml({ ...p, reference: '<img src=x onerror=alert(1)>' }, { shopName: '<b>x</b>', locale: 'en', dir: 'ltr', labels: L, methodLabel: 'Bank' });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('<script');
  });
});
