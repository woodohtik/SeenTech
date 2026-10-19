import { describe, it, expect } from 'vitest';
import { mapCustomerImportHeaders, parseCustomerImportRows } from './customerImport';

const reasons = {
  invalid: 'بيانات غير صالحة',
  duplicateExisting: 'مكرر مع عميل موجود',
  duplicateInFile: 'مكرر داخل نفس الملف',
};

describe('mapCustomerImportHeaders', () => {
  it('matches the hardcoded Arabic aliases', () => {
    const colIndex = mapCustomerImportHeaders(['الاسم', 'الهاتف', 'المدينة']);
    expect(colIndex).toEqual({ name: 0, phone: 1, city: 2 });
  });

  it('matches English aliases regardless of case', () => {
    const colIndex = mapCustomerImportHeaders(['NAME', 'phone', 'City']);
    expect(colIndex).toEqual({ name: 0, phone: 1, city: 2 });
  });

  it('matches a translated header passed in alongside the hardcoded aliases', () => {
    const colIndex = mapCustomerImportHeaders(['Nom'], { name: 'Nom' });
    expect(colIndex).toEqual({ name: 0 });
  });

  it('leaves a field unmapped when no header matches it', () => {
    const colIndex = mapCustomerImportHeaders(['الاسم']);
    expect(colIndex).toEqual({ name: 0 });
    expect(colIndex.phone).toBeUndefined();
  });

  it('ignores surrounding whitespace in headers', () => {
    const colIndex = mapCustomerImportHeaders(['  الاسم  ', ' الهاتف ']);
    expect(colIndex).toEqual({ name: 0, phone: 1 });
  });
});

describe('parseCustomerImportRows', () => {
  const colIndex = { name: 0, phone: 1, city: 2, address: 3, companyName: 4, trn: 5, notes: 6 };
  const header = ['الاسم', 'الهاتف', 'المدينة', 'العنوان', 'اسم الشركة', 'TRN', 'ملاحظات'];

  it('accepts a valid row and formats the phone number', () => {
    const raw = [header, ['أحمد محمد', '0501234567', 'الرياض', '', '', '', '']];
    const rows = parseCustomerImportRows(raw, colIndex, new Set(), reasons);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'valid', name: 'أحمد محمد', formattedPhone: '+966501234567' });
  });

  it('flags a row missing the required name as invalid', () => {
    const raw = [header, ['', '0501234567', '', '', '', '', '']];
    const rows = parseCustomerImportRows(raw, colIndex, new Set(), reasons);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('invalid');
  });

  it('flags a row missing the required phone as invalid', () => {
    const raw = [header, ['أحمد محمد', '', '', '', '', '', '']];
    const rows = parseCustomerImportRows(raw, colIndex, new Set(), reasons);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('invalid');
  });

  it('flags a malformed phone number as invalid', () => {
    const raw = [header, ['أحمد محمد', 'abc', '', '', '', '', '']];
    const rows = parseCustomerImportRows(raw, colIndex, new Set(), reasons);
    expect(rows[0].status).toBe('invalid');
  });

  it('flags a malformed 15-digit TRN as invalid', () => {
    const raw = [header, ['أحمد محمد', '0501234567', '', '', 'شركة الأمل', '123', '']];
    const rows = parseCustomerImportRows(raw, colIndex, new Set(), reasons);
    expect(rows[0].status).toBe('invalid');
  });

  it('accepts a valid 15-digit TRN', () => {
    const raw = [header, ['أحمد محمد', '0501234567', '', '', 'شركة الأمل', '300000000000003', '']];
    const rows = parseCustomerImportRows(raw, colIndex, new Set(), reasons);
    expect(rows[0].status).toBe('valid');
  });

  it('skips a fully blank row silently (no status at all)', () => {
    const raw = [header, ['', '', '', '', '', '', ''], ['أحمد محمد', '0501234567', '', '', '', '', '']];
    const rows = parseCustomerImportRows(raw, colIndex, new Set(), reasons);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('أحمد محمد');
  });

  it('flags a phone that already belongs to an existing customer as duplicate_existing', () => {
    const raw = [header, ['أحمد محمد', '0501234567', '', '', '', '', '']];
    const rows = parseCustomerImportRows(raw, colIndex, new Set(['+966501234567']), reasons);
    expect(rows[0].status).toBe('duplicate_existing');
  });

  it('flags the second occurrence of the same phone within the file as duplicate_in_file, keeping the first valid', () => {
    const raw = [
      header,
      ['أحمد محمد', '0501234567', '', '', '', '', ''],
      ['أحمد آخر', '+966501234567', '', '', '', '', ''], // same number, different formatting
    ];
    const rows = parseCustomerImportRows(raw, colIndex, new Set(), reasons);
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('valid');
    expect(rows[1].status).toBe('duplicate_in_file');
  });

  it('assigns rowNumber matching the real spreadsheet row (header is row 1)', () => {
    const raw = [header, ['أحمد محمد', '0501234567', '', '', '', '', '']];
    const rows = parseCustomerImportRows(raw, colIndex, new Set(), reasons);
    expect(rows[0].rowNumber).toBe(2);
  });

  it('returns an empty array when the sheet has only a header row', () => {
    const raw = [header];
    const rows = parseCustomerImportRows(raw, colIndex, new Set(), reasons);
    expect(rows).toHaveLength(0);
  });

  it('treats unmapped optional columns as empty rather than throwing', () => {
    const raw = [['الاسم', 'الهاتف'], ['أحمد محمد', '0501234567']];
    const partialColIndex = mapCustomerImportHeaders(raw[0]);
    const rows = parseCustomerImportRows(raw, partialColIndex, new Set(), reasons);
    expect(rows[0]).toMatchObject({ status: 'valid', city: '', address: '', companyName: '', trn: '', notes: '' });
  });
});
