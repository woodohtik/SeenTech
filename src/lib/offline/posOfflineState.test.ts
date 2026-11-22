// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cachedOpenShift, cachedTaxSettings, rememberOpenShift, rememberTaxSettings } from './posOfflineState';

// seen-readiness-fixes-task.md P3.1 (RELIABILITY-01, RELIABILITY-11).
const shift = { id: 's1', tenantId: 't1', branchId: 'b1', staffId: 'st1', openingBalance: 200, startTime: '2026-11-22T06:00:00Z', status: 'open' as const };

describe('the open shift kept on the device', () => {
  beforeEach(() => localStorage.clear());

  it('comes back for the same shop and employee', () => {
    rememberOpenShift('t1', 'st1', shift);
    expect(cachedOpenShift('t1', 'st1')).toEqual(shift);
  });
  it('is not given to another employee or another shop', () => {
    rememberOpenShift('t1', 'st1', shift);
    expect(cachedOpenShift('t1', 'st2')).toBeNull();
    expect(cachedOpenShift('t2', 'st1')).toBeNull();
  });
  it('is forgotten when the shift closes (or the server says there is none)', () => {
    rememberOpenShift('t1', 'st1', shift);
    rememberOpenShift('t1', 'st1', null);
    expect(cachedOpenShift('t1', 'st1')).toBeNull();
  });
});

describe('the tax settings kept on the device', () => {
  beforeEach(() => localStorage.clear());

  it('come back for the same shop only', () => {
    rememberTaxSettings('t1', { enabled: true, trn: '300000000000003', legalName: 'م', vatRate: 15 });
    expect(cachedTaxSettings('t1')).toMatchObject({ enabled: true, vatRate: 15 });
    expect(cachedTaxSettings('t2')).toBeNull();
  });
});
