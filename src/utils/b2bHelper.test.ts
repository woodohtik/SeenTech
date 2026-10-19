import { describe, it, expect } from 'vitest';
import { hasValidTaxSettings, calculateItemTax } from './b2bHelper';

describe('hasValidTaxSettings', () => {
  it('rejects when both trn and legalName are missing', () => {
    expect(hasValidTaxSettings(null)).toBe(false);
    expect(hasValidTaxSettings(undefined)).toBe(false);
    expect(hasValidTaxSettings({})).toBe(false);
  });

  it('rejects when only trn is set', () => {
    expect(hasValidTaxSettings({ trn: '300000000000003' })).toBe(false);
  });

  it('rejects when only legalName is set', () => {
    expect(hasValidTaxSettings({ legalName: 'مؤسسة حقيقية' })).toBe(false);
  });

  it('rejects empty-string values (not just missing ones)', () => {
    expect(hasValidTaxSettings({ trn: '', legalName: '' })).toBe(false);
    expect(hasValidTaxSettings({ trn: '300000000000003', legalName: '' })).toBe(false);
  });

  it('accepts when both trn and legalName are real, non-empty values', () => {
    expect(hasValidTaxSettings({ trn: '399999999900003', legalName: 'مؤسسة حقيقية للتفصيل' })).toBe(true);
  });
});

// مراجعة-الفريق-التقني-الكامل-2026-10-19.md (QA، حرجة): هذه الدالة -- حساب
// الضريبة الأساسي الذي تعتمد عليه POS.tsx/Orders.tsx/فواتير الطباعة بعد
// توحيدها على نفس الاستدعاء -- لم يكن لها أي اختبار رغم وجود هذا الملف
// لجارتها. فرق فلس من خطأ تقريب أو انعكاس شرط هنا ينعكس في كل مكان دفعة
// واحدة الآن، فتغطيته أعلى عائد ممكن مقابل الجهد.
describe('calculateItemTax', () => {
  it('exempt: no tax, final price equals raw price', () => {
    const result = calculateItemTax(100, 'exempt', 0.15, 2);
    expect(result).toEqual({ basePrice: 200, taxAmount: 0, finalPrice: 200 });
  });

  it('exclusive: tax added on top of the raw price', () => {
    const result = calculateItemTax(100, 'exclusive', 0.15, 2);
    expect(result).toEqual({ basePrice: 200, taxAmount: 30, finalPrice: 230 });
  });

  it('inclusive: tax extracted from the raw price, final price unchanged', () => {
    const result = calculateItemTax(115, 'inclusive', 0.15, 1);
    expect(result.finalPrice).toBe(115);
    expect(result.basePrice).toBeCloseTo(100, 2);
    expect(result.taxAmount).toBeCloseTo(15, 2);
  });

  it('defaults to the standard 15% VAT rate and quantity 1 when omitted', () => {
    const result = calculateItemTax(100, 'exclusive');
    expect(result).toEqual({ basePrice: 100, taxAmount: 15, finalPrice: 115 });
  });

  it('inclusive + exclusive agree on the same tax-exclusive base for the same net price', () => {
    // 100 exclusive -> 115 inclusive total; feeding that 115 back in as an
    // inclusive price must recover the same 100 base -- this is exactly the
    // invariant that broke when POS/Orders/printing each rolled their own
    // version of this formula independently.
    const asExclusive = calculateItemTax(100, 'exclusive', 0.15, 1);
    const asInclusive = calculateItemTax(asExclusive.finalPrice, 'inclusive', 0.15, 1);
    expect(asInclusive.basePrice).toBeCloseTo(100, 2);
  });

  it('rounds to 2 decimal places even with a rate that produces repeating decimals', () => {
    const result = calculateItemTax(33.33, 'inclusive', 0.15, 1);
    expect(Number.isFinite(result.basePrice)).toBe(true);
    expect(result.basePrice.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
    expect(result.taxAmount.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
  });
});
