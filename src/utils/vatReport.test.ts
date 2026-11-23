import { expect, test } from 'vitest';
import { computeVatSummary, ratePercent } from './vatReport';

const on15 = { enabled: true, vatRatePercentage: 15, taxType: 'exclusive' as const };
const base = {
  outputTaxOnSales: 150,
  refunds: [{ refunded_amount: 115 }],
  orderTaxRate: new Map<string, number>(),
  purchasesTotal: 2300,
  purchaseReturnsTotal: 230,
  tax: on15,
};

// What the report computed before (15% fixed), for the unchanged case.
function legacy(i: typeof base) {
  const totalRefunded = i.refunds.reduce((s, r) => s + Number(r.refunded_amount || 0), 0);
  const refundedVat = totalRefunded - totalRefunded / 1.15;
  const outputVat = i.outputTaxOnSales - refundedVat;
  const inputVat = (i.purchasesTotal - i.purchasesTotal / 1.15) - (i.purchaseReturnsTotal - i.purchaseReturnsTotal / 1.15);
  return { outputVat, inputVat, netVatDue: outputVat - inputVat };
}

test('a shop with tax on at 15% gets what the report showed before', () => {
  const now = computeVatSummary(base);
  const before = legacy(base);
  expect(now.outputVat).toBeCloseTo(before.outputVat, 9);
  expect(now.inputVat).toBeCloseTo(before.inputVat, 9);
  expect(now.netVatDue).toBeCloseTo(before.netVatDue, 9);
  expect(now.outputVat).toBeCloseTo(135, 9); // 150 - 15
  expect(now.inputVat).toBeCloseTo(270, 9); // 300 - 30
});

test("the shop's own rate is used, not 15", () => {
  const s = computeVatSummary({ ...base, tax: { ...on15, vatRatePercentage: 5 }, refunds: [{ refunded_amount: 105 }], purchasesTotal: 2100, purchaseReturnsTotal: 0 });
  expect(s.outputVat).toBeCloseTo(145, 9); // 150 - 5
  expect(s.inputVat).toBeCloseTo(100, 9); // 2100 - 2000
});

test('a shop with tax off reclaims no input VAT and is never shown a refund it is not owed', () => {
  const s = computeVatSummary({ ...base, outputTaxOnSales: 0, tax: { ...on15, enabled: false } });
  expect(s).toEqual({ outputVat: 0, inputVat: 0, netVatDue: 0 });
});

test("a refund takes its original order's stored rate: no VAT out of an order sold without tax", () => {
  const s = computeVatSummary({
    ...base,
    refunds: [{ refunded_amount: 115, order_id: 'a' }, { refunded_amount: 100, order_id: 'b' }],
    orderTaxRate: new Map([['a', 0.15], ['b', 0]]),
    purchasesTotal: 0,
    purchaseReturnsTotal: 0,
  });
  expect(s.outputVat).toBeCloseTo(135, 9); // 150 - 15 (order a) - 0 (order b)
});

test('stored rates: 15 and 0.15 both mean 15%; blank is unknown', () => {
  expect(ratePercent(15)).toBe(15);
  expect(ratePercent('0.1500')).toBeCloseTo(15, 9);
  expect(ratePercent('15.0000')).toBe(15);
  expect(ratePercent(0)).toBe(0);
  expect(ratePercent(null)).toBeNull();
  expect(ratePercent('')).toBeNull();
});

// P6 (MONEY-13): a credit sale's return gives no cash back, but its credit
// note still takes the VAT off -- the note's value counts, not the cash.
test('output VAT comes off by the credit note value, even with nothing refunded in cash', () => {
  const s = computeVatSummary({ ...base, refunds: [{ refunded_amount: 0, total_amount: 115 }] });
  expect(s.outputVat).toBeCloseTo(135, 9); // 150 - 15, as with a cash refund of 115
  const older = computeVatSummary({ ...base, refunds: [{ refunded_amount: 115 }] }); // rows without total_amount
  expect(older.outputVat).toBeCloseTo(135, 9);
});
