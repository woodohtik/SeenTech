/**
 * seen-readiness-fixes-task.md P1.1: writes src/shared/taxEngineCases.json --
 * 30 sales and their figures by the one tax engine (src/shared/taxEngine.ts).
 * The figures are then frozen: the TS engine, the database's
 * app_tax_document() and the ZATCA XML are all tested against this file.
 *   npx tsx scripts/tax/gen-cases.ts
 */
import fs from 'node:fs';
import { computeTaxDocument, type TaxDocumentInput } from '../../src/shared/taxEngine';

const R = 0.15;
const L = (price: number, quantity: number, taxType?: 'inclusive' | 'exclusive' | 'exempt') => ({ price, quantity, ...(taxType ? { taxType } : {}) });

const inputs: Array<{ name: string; input: TaxDocumentInput }> = [
  { name: 'exclusive 100', input: { lines: [L(100, 1, 'exclusive')], rate: R } },
  { name: 'inclusive 115', input: { lines: [L(115, 1, 'inclusive')], rate: R } },
  { name: 'exempt 50', input: { lines: [L(50, 1, 'exempt')], rate: R } },
  { name: 'no type = exclusive', input: { lines: [L(100, 1)], rate: R } },
  { name: 'tax off, inclusive price', input: { lines: [L(115, 1, 'inclusive')], rate: 0 } },
  { name: 'tax off, exclusive price', input: { lines: [L(100, 2, 'exclusive')], rate: 0 } },
  { name: 'fixed 10 off exclusive 100 (review MONEY-04)', input: { lines: [L(100, 1, 'exclusive')], rate: R, discountType: 'fixed', discountValue: 10 } },
  { name: '3 x 10.05 exclusive (review MONEY-04)', input: { lines: [L(10.05, 1), L(10.05, 1), L(10.05, 1)], rate: R } },
  { name: '10.05 x 3 on one line', input: { lines: [L(10.05, 3)], rate: R } },
  { name: '10% off inclusive 115', input: { lines: [L(115, 1, 'inclusive')], rate: R, discountType: 'percent', discountValue: 10 } },
  { name: 'mixed three types', input: { lines: [L(100, 1, 'exclusive'), L(57.5, 2, 'inclusive'), L(20, 1, 'exempt')], rate: R } },
  { name: 'mixed, fixed 25 off', input: { lines: [L(100, 1, 'exclusive'), L(57.5, 2, 'inclusive'), L(20, 1, 'exempt')], rate: R, discountType: 'fixed', discountValue: 25 } },
  { name: 'mixed, 15% off', input: { lines: [L(100, 1, 'exclusive'), L(57.5, 2, 'inclusive'), L(20, 1, 'exempt')], rate: R, discountType: 'percent', discountValue: 15 } },
  { name: 'fixed above the total', input: { lines: [L(40, 1, 'exclusive')], rate: R, discountType: 'fixed', discountValue: 500 } },
  { name: '100% off', input: { lines: [L(40, 1, 'inclusive'), L(9.99, 1)], rate: R, discountType: 'percent', discountValue: 100 } },
  { name: 'percent above 100 caps at 100', input: { lines: [L(12.34, 1)], rate: R, discountType: 'percent', discountValue: 150 } },
  { name: 'role cap 10% on a 30% request', input: { lines: [L(200, 1, 'exclusive')], rate: R, discountType: 'percent', discountValue: 30, maxDiscountPercent: 10 } },
  { name: 'role cap 5% on a fixed 50', input: { lines: [L(200, 1, 'inclusive')], rate: R, discountType: 'fixed', discountValue: 50, maxDiscountPercent: 5 } },
  { name: 'cloth by the metre 2.5 x 37.4', input: { lines: [L(37.4, 2.5, 'inclusive')], rate: R } },
  { name: 'cloth 1.75 m exclusive + buttons', input: { lines: [L(48.6, 1.75, 'exclusive'), L(0.35, 12, 'exclusive')], rate: R } },
  { name: 'halala edge 0.01 x 3', input: { lines: [L(0.01, 3)], rate: R } },
  { name: 'halala edge inclusive 0.05', input: { lines: [L(0.05, 1, 'inclusive')], rate: R } },
  { name: 'rounding x.xx5', input: { lines: [L(1.005, 1), L(2.675, 1, 'inclusive')], rate: R } },
  { name: 'discount spread over 7 equal lines', input: { lines: Array.from({ length: 7 }, () => L(14.29, 1, 'inclusive')), rate: R, discountType: 'fixed', discountValue: 10 } },
  { name: 'tailoring thobe exclusive x2, fixed 20', input: { lines: [L(250, 2, 'exclusive')], rate: R, discountType: 'fixed', discountValue: 20 } },
  { name: 'tailoring inclusive x3, fixed 30', input: { lines: [L(287.5, 3, 'inclusive')], rate: R, discountType: 'fixed', discountValue: 30 } },
  { name: 'tailoring exempt shop, fixed 15', input: { lines: [L(180, 1, 'exempt'), L(90, 1, 'exempt')], rate: R, discountType: 'fixed', discountValue: 15 } },
  { name: 'zero-price line', input: { lines: [L(0, 1), L(99.99, 1, 'inclusive')], rate: R } },
  { name: 'large sale', input: { lines: [L(1234.56, 7, 'exclusive'), L(999.99, 3, 'inclusive')], rate: R, discountType: 'percent', discountValue: 12.5 } },
  { name: '5% rate (other rate)', input: { lines: [L(100, 1, 'exclusive'), L(105, 1, 'inclusive')], rate: 0.05, discountType: 'fixed', discountValue: 5 } },
];

const cases = inputs.map(({ name, input }) => ({ name, input, expected: computeTaxDocument(input) }));
fs.writeFileSync('src/shared/taxEngineCases.json', JSON.stringify(cases, null, 1) + '\n');
console.log(`wrote ${cases.length} cases`);
for (const c of cases.slice(0, 8)) console.log(c.name, '=> total', c.expected.total, 'subtotal', c.expected.subtotal, 'tax', c.expected.tax);
