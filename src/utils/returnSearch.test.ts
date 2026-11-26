import { expect, test } from 'vitest';
import { invoiceNumberCandidates, matchesReturnSearch } from './returnSearch';

// Found by golden path 7 (seen-stability-guardrails-task.md): the returns box
// asks for "the invoice number", and typing the number on the receipt
// (INV-21) found nothing -- the search looked at order numbers and ids only.

const order = { id: 'aaaaaaaa-0000-4000-8000-0000000c09e1', order_number: 7, customer_id: 'c1' };

test('the receipt\'s invoice number finds its order', () => {
  expect(matchesReturnSearch(order, 'INV-21', { invoiceOrderIds: ['aaaaaaaa-0000-4000-8000-0000000c09e1'], customerIds: [] })).toBe(true);
});

test('the order number, the id\'s end, and the customer\'s phone still work', () => {
  expect(matchesReturnSearch(order, '7', { invoiceOrderIds: [], customerIds: [] })).toBe(true);
  expect(matchesReturnSearch(order, '0C09E1', { invoiceOrderIds: [], customerIds: [] })).toBe(true);
  expect(matchesReturnSearch(order, '0500000123', { invoiceOrderIds: [], customerIds: ['c1'] })).toBe(true);
  expect(matchesReturnSearch(order, '99', { invoiceOrderIds: [], customerIds: [] })).toBe(false);
});

test('"21", "inv-21" and "INV-21" all mean the same invoice', () => {
  expect(invoiceNumberCandidates('21')).toEqual(expect.arrayContaining(['21', 'INV-21']));
  expect(invoiceNumberCandidates('inv-21')).toEqual(expect.arrayContaining(['INV-21']));
  expect(invoiceNumberCandidates(' INV-21 ')).toEqual(expect.arrayContaining(['INV-21']));
});
