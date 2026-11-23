import { describe, expect, it } from 'vitest';
import { sellerForInvoice } from './sellerDetails';

// seen-readiness-fixes-task.md P6 (ZATCA-16, CODEHEALTH-09).
const official = { name: 'مؤسسة الأناقة للخياطة', vatNumber: '310000000000003', address: 'الرياض', phone: '0110000000' };
const header = { facilityName: 'اسم آخر', taxId: '399999999900003', address: 'جدة', contactNumbers: '0500000000', logoUrl: 'logo.png' };

describe('sellerForInvoice', () => {
  it("the browser's layout settings cannot replace the legal name, VAT number or address", () => {
    const s = sellerForInvoice(official, header);
    expect(s.name).toBe('مؤسسة الأناقة للخياطة');
    expect(s.vatNumber).toBe('310000000000003');
    expect(s.address).toBe('الرياض');
  });

  it('they still choose the contact numbers and the logo', () => {
    const s = sellerForInvoice(official, header);
    expect(s.phone).toBe('0500000000');
    expect(s.logoUrl).toBe('logo.png');
  });

  it('a shop with no official details yet prints what it typed, not blanks', () => {
    const s = sellerForInvoice({ name: '', vatNumber: '000000000000000', address: null }, header);
    expect(s.name).toBe('اسم آخر');
    expect(s.vatNumber).toBe('399999999900003'); // all zeros was a placeholder, not a number
    expect(s.address).toBe('جدة');
  });

  it('nothing anywhere: empty, for the caller to decide', () => {
    expect(sellerForInvoice(null, null)).toMatchObject({ name: '', vatNumber: '', address: '', phone: '', logoUrl: '' });
  });
});
