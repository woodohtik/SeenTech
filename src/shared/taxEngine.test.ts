import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import cases from './taxEngineCases.json';
import { computeTaxDocument, round2, type TaxDocumentInput } from './taxEngine';
import { buildSqlTest, SQL_TEST } from '../../scripts/tax/gen-sql-test';
import { computeCartTotals } from '../utils/cartTotals';

type Case = { name: string; input: TaxDocumentInput; expected: ReturnType<typeof computeTaxDocument> };
const all = cases as unknown as Case[];
const sum = (xs: number[]) => xs.reduce((s, x) => round2(s + x), 0);

// seen-readiness-fixes-task.md P1.1: one engine, one truth table.
describe('the truth table (src/shared/taxEngineCases.json)', () => {
  test('has the 30 cases', () => expect(all).toHaveLength(30));

  test.each(all.map((c) => [c.name, c] as const))('%s -- frozen figures', (_n, c) => {
    expect(computeTaxDocument(c.input)).toEqual(c.expected);
  });

  test.each(all.map((c) => [c.name, c] as const))('%s -- the document is the sum of its lines', (_n, c) => {
    const d = c.expected;
    expect(sum(d.lines.map((l) => l.netAfter))).toBe(d.subtotal);
    expect(sum(d.lines.map((l) => l.taxAfter))).toBe(d.tax);
    expect(sum(d.lines.map((l) => l.grossAfter))).toBe(d.total);
    expect(round2(d.subtotal + d.tax)).toBe(d.total);
    expect(round2(d.grossBefore - d.discountGross)).toBe(d.total);
    expect(sum(d.lines.map((l) => l.discount))).toBe(d.discountGross);
    for (const l of d.lines) {
      expect(l.grossAfter).toBeGreaterThanOrEqual(0);
      expect(l.taxAfter).toBeGreaterThanOrEqual(0);
      if (l.taxType === 'exempt') expect(l.taxAfter).toBe(0);
    }
  });

  test("the database's test is generated from this table (npx tsx scripts/tax/gen-sql-test.ts)", () => {
    expect(fs.readFileSync(SQL_TEST, 'utf-8').replace(/\r\n/g, '\n')).toBe(buildSqlTest());
  });

  test('the cart gives the same totals as the engine (what the server records)', () => {
    for (const c of all.filter((x) => x.input.maxDiscountPercent == null)) {
      const cart = computeCartTotals(
        c.input.lines.map((l) => ({ price: l.price, quantity: l.quantity, taxType: l.taxType ?? undefined })),
        { enabled: c.input.rate > 0, vatRate: c.input.rate * 100 },
        c.input.discountType ?? 'percent',
        c.input.discountValue ?? 0,
      );
      expect(cart.totalAmount, c.name).toBe(c.expected.total);
      expect(cart.taxAmount, c.name).toBe(c.expected.tax);
      expect(cart.discountedSubtotal, c.name).toBe(c.expected.subtotal);
    }
  });
});

describe('round2 rounds half away from zero, like PostgreSQL round()', () => {
  test.each([[1.005, 1.01], [2.675, 2.68], [1.0049999, 1], [0.125, 0.13], [-1.005, -1.01], [115 / 1.15, 100]])('%f -> %f', (x, y) => {
    expect(round2(x)).toBe(y);
  });
});
