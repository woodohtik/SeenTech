import { describe, expect, it } from 'vitest';
import { parseShiftCashBalance, previewCashLines } from './shiftCash';

const local = { opening: 100, cash: 0, deposits: 0, cashReturns: 0, withdrawals: 0 };

describe('parseShiftCashBalance', () => {
  it('reads the row whether it arrives alone or as a one-row array', () => {
    const row = { opening: '100', sales: '50.00', deposits: 20, withdrawals: 5, returns: 0, total: '165.00' };
    const parsed = { opening: 100, sales: 50, deposits: 20, withdrawals: 5, returns: 0, total: 165 };
    expect(parseShiftCashBalance(row)).toEqual(parsed);
    expect(parseShiftCashBalance([row])).toEqual(parsed);
  });

  it('returns null when there is no row', () => {
    expect(parseShiftCashBalance(null)).toBeNull();
    expect(parseShiftCashBalance([])).toBeNull();
  });
});

describe('previewCashLines', () => {
  it('uses the server figures, so a tailoring deposit shows in the expected cash', () => {
    // The orders summed locally carry no cash (a tailoring order has no shift
    // on it), but a 50 deposit was paid on the shift.
    const server = { opening: 100, sales: 50, deposits: 0, withdrawals: 0, returns: 0, total: 150 };
    expect(previewCashLines(server, local)).toEqual({
      opening: 100, cash: 50, deposits: 0, cashReturns: 0, withdrawals: 0, expected: 150,
    });
  });

  it('subtracts refunds and withdrawals and adds drawer deposits', () => {
    const server = { opening: 0, sales: 300, deposits: 40, withdrawals: 25.5, returns: 60, total: 254.5 };
    expect(previewCashLines(server, local).expected).toBe(254.5);
  });

  it('falls back to the locally summed lines when the server figure is unavailable', () => {
    const offline = { opening: 100, cash: 30, deposits: 10, cashReturns: 5, withdrawals: 15 };
    expect(previewCashLines(null, offline)).toEqual({ ...offline, expected: 120 });
  });
});
