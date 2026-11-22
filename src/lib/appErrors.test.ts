import { describe, expect, it } from 'vitest';

// seen-readiness-fixes-task.md P1.3: the server's own reasons reach the employee.
import { dbRefusalMessage } from './appErrors';
describe('dbRefusalMessage', () => {
  it('passes on a deliberate refusal in the shop\'s language', () => {
    expect(dbRefusalMessage({ code: '22023', message: 'افتح وردية قبل استلام أي دفعة' })).toBe('افتح وردية قبل استلام أي دفعة');
    expect(dbRefusalMessage({ code: '23514', message: 'المبلغ أكبر من المتبقي على الطلب (المتبقي 5)' })).toContain('المتبقي');
  });
  it('keeps everything else to the generic path', () => {
    expect(dbRefusalMessage({ code: '42501', message: 'forbidden' })).toBeNull();
    expect(dbRefusalMessage({ code: '23505', message: 'duplicate key value' })).toBeNull();
    expect(dbRefusalMessage({ code: '22023', message: 'invalid input syntax' })).toBeNull();
    expect(dbRefusalMessage(null)).toBeNull();
  });
});

describe('getFriendlyErrorMessage (P4)', () => {
  it("shows the server's own refusal, with its reason, instead of a generic message", async () => {
    const { getFriendlyErrorMessage } = await import('./appErrors');
    expect(getFriendlyErrorMessage({ code: '22023', message: 'لا يُحذف عميل له طلبات مفتوحة أو مبلغ متبقٍ' }))
      .toBe('لا يُحذف عميل له طلبات مفتوحة أو مبلغ متبقٍ');
    expect(getFriendlyErrorMessage({ code: '42501', message: 'forbidden' })).not.toBe('forbidden');
  });
});

describe('getFriendlyErrorMessage (P4, UX-05)', () => {
  it('never shows technical English from the database as it is', async () => {
    const { getFriendlyErrorMessage } = await import('./appErrors');
    const generic = getFriendlyErrorMessage({ message: 'supplier not found' });
    expect(generic).not.toBe('supplier not found');
    expect(getFriendlyErrorMessage({ message: 'already_processed: request is already approved' })).toBe(generic);
  });
});
