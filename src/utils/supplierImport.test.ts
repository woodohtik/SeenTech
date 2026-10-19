import { describe, it, expect } from 'vitest';
import { mapSupplierImportHeaders, parseSupplierImportRows } from './supplierImport';

const reasons = {
  invalid: 'بيانات غير صالحة',
  duplicateExisting: 'مكرر مع مورد موجود',
  duplicateInFile: 'مكرر داخل نفس الملف',
  unknownCategory: 'تصنيف غير معروف',
};

const categoryOptions = [
  { value: 'fabric', label: 'أقمشة' },
  { value: 'custom_hardware_abc', label: 'عتاد' },
];

const header = ['الاسم', 'الهاتف', 'الشخص المسؤول', 'البريد الإلكتروني', 'العنوان', 'الرقم الضريبي', 'التصنيف', 'الرصيد الافتتاحي'];
const colIndex = {
  name: 0, phone: 1, contactPerson: 2, email: 3, address: 4, taxNumber: 5, category: 6, openingBalance: 7,
};

describe('mapSupplierImportHeaders', () => {
  it('matches all eight columns by their Arabic header', () => {
    expect(mapSupplierImportHeaders(header)).toEqual(colIndex);
  });

  it('matches English aliases', () => {
    expect(mapSupplierImportHeaders(['Name', 'Phone', 'Category'])).toEqual({ name: 0, phone: 1, category: 2 });
  });
});

describe('parseSupplierImportRows', () => {
  it('accepts a fully-specified valid row and formats the phone', () => {
    const raw = [header, ['مؤسسة الأقمشة', '0501234567', 'أحمد', 'a@example.com', 'الرياض', '300000000000003', 'أقمشة', '500']];
    const rows = parseSupplierImportRows(raw, colIndex, categoryOptions, new Set(), reasons);
    expect(rows[0]).toMatchObject({
      status: 'valid',
      resolved: {
        name: 'مؤسسة الأقمشة', phone: '+966501234567', contactPerson: 'أحمد', email: 'a@example.com',
        categoryKey: 'fabric', openingBalance: 500,
      },
    });
  });

  it('matches a custom tenant category by its label', () => {
    const raw = [header, ['مورد عتاد', '0501234567', '', '', '', '', 'عتاد', '']];
    const rows = parseSupplierImportRows(raw, colIndex, categoryOptions, new Set(), reasons);
    expect(rows[0].resolved?.categoryKey).toBe('custom_hardware_abc');
  });

  it('defaults contactPerson/email/address/taxNumber to empty and openingBalance to 0', () => {
    const raw = [header, ['مؤسسة الأقمشة', '0501234567', '', '', '', '', 'أقمشة', '']];
    const rows = parseSupplierImportRows(raw, colIndex, categoryOptions, new Set(), reasons);
    expect(rows[0].resolved).toMatchObject({ contactPerson: '', email: '', address: '', taxNumber: '', openingBalance: 0 });
  });

  it('flags a row with no name as invalid', () => {
    const raw = [header, ['', '0501234567', '', '', '', '', 'أقمشة', '']];
    const rows = parseSupplierImportRows(raw, colIndex, categoryOptions, new Set(), reasons);
    expect(rows[0].status).toBe('invalid');
  });

  it('flags a missing or malformed phone as invalid (phone is required)', () => {
    const rawMissing = [header, ['مؤسسة الأقمشة', '', '', '', '', '', 'أقمشة', '']];
    const rawBad = [header, ['مؤسسة الأقمشة', 'abc', '', '', '', '', 'أقمشة', '']];
    expect(parseSupplierImportRows(rawMissing, colIndex, categoryOptions, new Set(), reasons)[0].status).toBe('invalid');
    expect(parseSupplierImportRows(rawBad, colIndex, categoryOptions, new Set(), reasons)[0].status).toBe('invalid');
  });

  it('flags a malformed email as invalid', () => {
    const raw = [header, ['مؤسسة الأقمشة', '0501234567', '', 'not-an-email', '', '', 'أقمشة', '']];
    const rows = parseSupplierImportRows(raw, colIndex, categoryOptions, new Set(), reasons);
    expect(rows[0].status).toBe('invalid');
  });

  it('flags a tax number that is not exactly 15 digits as invalid', () => {
    const raw = [header, ['مؤسسة الأقمشة', '0501234567', '', '', '', '12345', 'أقمشة', '']];
    const rows = parseSupplierImportRows(raw, colIndex, categoryOptions, new Set(), reasons);
    expect(rows[0].status).toBe('invalid');
  });

  it('flags a category not in the tenant\'s own list as invalid', () => {
    const raw = [header, ['مؤسسة الأقمشة', '0501234567', '', '', '', '', 'تصنيف غريب', '']];
    const rows = parseSupplierImportRows(raw, colIndex, categoryOptions, new Set(), reasons);
    expect(rows[0]).toMatchObject({ status: 'invalid', reason: reasons.unknownCategory });
  });

  it('flags a negative opening balance as invalid', () => {
    const raw = [header, ['مؤسسة الأقمشة', '0501234567', '', '', '', '', 'أقمشة', '-10']];
    const rows = parseSupplierImportRows(raw, colIndex, categoryOptions, new Set(), reasons);
    expect(rows[0].status).toBe('invalid');
  });

  it('flags a phone already belonging to an existing supplier as duplicate_existing', () => {
    const raw = [header, ['مؤسسة الأقمشة', '0501234567', '', '', '', '', 'أقمشة', '']];
    const rows = parseSupplierImportRows(raw, colIndex, categoryOptions, new Set(['+966501234567']), reasons);
    expect(rows[0]).toMatchObject({ status: 'duplicate_existing', reason: reasons.duplicateExisting });
  });

  it('flags the second occurrence of the same phone within the file as duplicate_in_file', () => {
    const raw = [
      header,
      ['مؤسسة الأقمشة', '0501234567', '', '', '', '', 'أقمشة', ''],
      ['مؤسسة أخرى', '+966501234567', '', '', '', '', 'أقمشة', ''],
    ];
    const rows = parseSupplierImportRows(raw, colIndex, categoryOptions, new Set(), reasons);
    expect(rows[0].status).toBe('valid');
    expect(rows[1]).toMatchObject({ status: 'duplicate_in_file', reason: reasons.duplicateInFile });
  });

  it('skips a fully blank row silently', () => {
    const raw = [header, ['', '', '', '', '', '', '', ''], ['مؤسسة الأقمشة', '0501234567', '', '', '', '', 'أقمشة', '']];
    const rows = parseSupplierImportRows(raw, colIndex, categoryOptions, new Set(), reasons);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('مؤسسة الأقمشة');
  });

  it('assigns rowNumber matching the real spreadsheet row', () => {
    const raw = [header, ['مؤسسة الأقمشة', '0501234567', '', '', '', '', 'أقمشة', '']];
    const rows = parseSupplierImportRows(raw, colIndex, categoryOptions, new Set(), reasons);
    expect(rows[0].rowNumber).toBe(2);
  });
});
