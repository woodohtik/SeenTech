import { customerSchema } from '../lib/validations';

export const CUSTOMER_IMPORT_COLUMN_FIELDS = ['name', 'phone', 'city', 'address', 'companyName', 'trn', 'notes'] as const;
export type CustomerImportField = (typeof CUSTOMER_IMPORT_COLUMN_FIELDS)[number];

/**
 * Arabic/English literals here are intentional fallbacks alongside the
 * current-locale translated header (passed in separately by the caller):
 * the template this generates always carries the active UI language's
 * headers, but a merchant may re-upload an older template or hand-edit
 * headers in another language, so matching accepts either without
 * requiring the UI language to match at both ends.
 */
export const CUSTOMER_IMPORT_COLUMN_ALIASES: Record<CustomerImportField, string[]> = {
  name: ['الاسم', 'اسم العميل', 'Name'],
  phone: ['الهاتف', 'رقم الهاتف', 'Phone'],
  city: ['المدينة', 'City'],
  address: ['العنوان', 'Address'],
  companyName: ['اسم الشركة (B2B)', 'اسم الشركة', 'Company Name (B2B)', 'Company Name'],
  trn: ['الرقم الضريبي TRN', 'الرقم الضريبي', 'TRN', 'Tax Number (TRN)'],
  notes: ['ملاحظات', 'Notes'],
};

export interface CustomerImportRow {
  rowNumber: number;
  name: string;
  phone: string;
  city: string;
  address: string;
  companyName: string;
  trn: string;
  notes: string;
  status: 'valid' | 'duplicate_existing' | 'duplicate_in_file' | 'invalid';
  reason?: string;
  formattedPhone?: string;
}

/** Maps a raw header row (row 0 of the uploaded sheet) to a column index per field. */
export function mapCustomerImportHeaders(
  headerRow: string[],
  translatedAliases: Partial<Record<CustomerImportField, string>> = {}
): Partial<Record<CustomerImportField, number>> {
  const normalizedHeader = headerRow.map((h) => String(h ?? '').trim().toLowerCase());
  const colIndex: Partial<Record<CustomerImportField, number>> = {};
  CUSTOMER_IMPORT_COLUMN_FIELDS.forEach((field) => {
    const aliases = [translatedAliases[field], ...CUSTOMER_IMPORT_COLUMN_ALIASES[field]]
      .filter((a): a is string => !!a)
      .map((a) => a.trim().toLowerCase());
    const idx = normalizedHeader.findIndex((h) => aliases.includes(h));
    if (idx !== -1) colIndex[field] = idx;
  });
  return colIndex;
}

/**
 * مراجعة-الفريق-التقني-الكامل-2026-10-19.md جلسة brainstorming (العملاء، أول
 * كيان من ثلاثة: عملاء/منتجات/موردين) -- يعيد استخدام customerSchema نفسه
 * (lib/validations.ts) لكل صف بدل تكرار قواعد التحقق، فتهريب رقم الهاتف
 * (formatSaudiPhone) وتنسيق الرقم الضريبي (15 رقماً) يحدثان بنفس الصرامة
 * المطبَّقة على نموذج الإضافة اليدوية بالضبط.
 *
 * لا قيد تكرار على customers.phone في قاعدة البيانات (فهرس بحث فقط) -- هذا
 * أول تحقق فعلي لتكرار الهاتف في المشروع كله، ضروري هنا تحديداً لأن استيراد
 * ملف كامل مرتين بالخطأ أخطر بكثير من إدخال يدوي مكرر عرَضي. existingPhones
 * يجب أن يكون مُنسَّقاً مسبقاً بنفس صيغة formatSaudiPhone (مطابق لما هو
 * مخزَّن فعلياً في قاعدة البيانات).
 */
export function parseCustomerImportRows(
  raw: any[][],
  colIndex: Partial<Record<CustomerImportField, number>>,
  existingPhones: Set<string>,
  reasons: { invalid: string; duplicateExisting: string; duplicateInFile: string }
): CustomerImportRow[] {
  const seenPhones = new Set<string>();
  const parsed: CustomerImportRow[] = [];

  for (let i = 1; i < raw.length; i++) {
    const rawRow = raw[i] || [];
    const get = (field: CustomerImportField): string => {
      const idx = colIndex[field];
      return idx === undefined ? '' : String(rawRow[idx] ?? '').trim();
    };

    const name = get('name');
    const phone = get('phone');
    const city = get('city');
    const address = get('address');
    const companyName = get('companyName');
    const trn = get('trn');
    const notes = get('notes');

    if (!name && !phone && !city && !address && !companyName && !trn && !notes) continue;

    const rowNumber = i + 1; // 1-based spreadsheet row; header occupies row 1
    const base = { rowNumber, name, phone, city, address, companyName, trn, notes };

    const result = customerSchema.safeParse({
      name,
      phone,
      companyName: companyName || undefined,
      trn: trn || undefined,
      address: address || undefined,
      city: city || undefined,
    });

    if (!result.success) {
      parsed.push({ ...base, status: 'invalid', reason: result.error.issues[0]?.message || reasons.invalid });
      continue;
    }

    const formattedPhone = result.data.phone;
    if (existingPhones.has(formattedPhone)) {
      parsed.push({ ...base, status: 'duplicate_existing', formattedPhone, reason: reasons.duplicateExisting });
      continue;
    }
    if (seenPhones.has(formattedPhone)) {
      parsed.push({ ...base, status: 'duplicate_in_file', formattedPhone, reason: reasons.duplicateInFile });
      continue;
    }
    seenPhones.add(formattedPhone);
    parsed.push({ ...base, status: 'valid', formattedPhone });
  }

  return parsed;
}
