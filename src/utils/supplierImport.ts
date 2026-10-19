import { formatSaudiPhone } from './phoneUtils';

export const SUPPLIER_IMPORT_COLUMN_FIELDS = [
  'name', 'phone', 'contactPerson', 'email', 'address', 'taxNumber', 'category', 'openingBalance',
] as const;
export type SupplierImportField = (typeof SUPPLIER_IMPORT_COLUMN_FIELDS)[number];

/** Same fallback-alias rationale as customerImport.ts's CUSTOMER_IMPORT_COLUMN_ALIASES. */
export const SUPPLIER_IMPORT_COLUMN_ALIASES: Record<SupplierImportField, string[]> = {
  name: ['الاسم', 'اسم المورد', 'Name'],
  phone: ['الهاتف', 'رقم الهاتف', 'Phone'],
  contactPerson: ['الشخص المسؤول', 'المسؤول', 'Contact Person'],
  email: ['البريد الإلكتروني', 'الايميل', 'Email'],
  address: ['العنوان', 'Address'],
  taxNumber: ['الرقم الضريبي', 'Tax Number'],
  category: ['التصنيف', 'الفئة', 'Category'],
  openingBalance: ['الرصيد الافتتاحي', 'Opening Balance'],
};

export interface SupplierImportRow {
  rowNumber: number;
  name: string;
  phoneText: string;
  contactPerson: string;
  email: string;
  address: string;
  taxNumber: string;
  categoryText: string;
  openingBalanceText: string;
  status: 'valid' | 'duplicate_existing' | 'duplicate_in_file' | 'invalid';
  reason?: string;
  resolved?: {
    name: string;
    phone: string;
    contactPerson: string;
    email: string;
    address: string;
    taxNumber: string;
    categoryKey: string;
    openingBalance: number;
  };
}

export function mapSupplierImportHeaders(
  headerRow: string[],
  translatedAliases: Partial<Record<SupplierImportField, string>> = {}
): Partial<Record<SupplierImportField, number>> {
  const normalizedHeader = headerRow.map((h) => String(h ?? '').trim().toLowerCase());
  const colIndex: Partial<Record<SupplierImportField, number>> = {};
  SUPPLIER_IMPORT_COLUMN_FIELDS.forEach((field) => {
    const aliases = [translatedAliases[field], ...SUPPLIER_IMPORT_COLUMN_ALIASES[field]]
      .filter((a): a is string => !!a)
      .map((a) => a.trim().toLowerCase());
    const idx = normalizedHeader.findIndex((h) => aliases.includes(h));
    if (idx !== -1) colIndex[field] = idx;
  });
  return colIndex;
}

const PHONE_REGEX = /^(\+?\d{1,3}[- ]?)?\d{8,12}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * مراجعة-الفريق-التقني-الكامل-2026-10-19.md جلسة brainstorming (الموردون،
 * ثالث وآخر كيان: عملاء/منتجات/موردين). لا يُعاد استخدام supplierSchema
 * (lib/validations.ts) هنا عمداً -- حقله category ثابت على enum قديم
 * (fabric/accessories/thread/button/lining/other) لا يعرف فئات المستأجر
 * المخصَّصة (tenant_categories)، فإعادة استخدامه كانت سترفض أي فئة مخصَّصة
 * أنشأها التاجر فعلياً. التحقق هنا مطابق لنمط productImport.ts: يطابق
 * التصنيف مع قائمة المستأجر الفعلية مباشرة. contactPerson أيضاً إلزامي في
 * النموذج اليدوي لكنه اختياري هنا عمداً -- كثير من موردي القوائم القديمة لا
 * يُعرَف لهم شخص مسؤول محدَّد، وإلزامه كان سيُسقِط صفوفاً صالحة بلا داعٍ.
 *
 * لا قيد تكرار في قاعدة البيانات على suppliers.phone (فهرس اسم فقط) --
 * نفس فلسفة customerImport.ts بالضبط: تخطَّ + أبلِغ، على الهاتف المُنسَّق
 * (formatSaudiPhone) لا النص الخام.
 */
export function parseSupplierImportRows(
  raw: any[][],
  colIndex: Partial<Record<SupplierImportField, number>>,
  categoryOptions: { value: string; label: string }[],
  existingPhones: Set<string>,
  reasons: {
    invalid: string;
    duplicateExisting: string;
    duplicateInFile: string;
    unknownCategory: string;
  }
): SupplierImportRow[] {
  const seenPhones = new Set<string>();
  const parsed: SupplierImportRow[] = [];

  for (let i = 1; i < raw.length; i++) {
    const rawRow = raw[i] || [];
    const get = (field: SupplierImportField): string => {
      const idx = colIndex[field];
      return idx === undefined ? '' : String(rawRow[idx] ?? '').trim();
    };

    const name = get('name');
    const phoneText = get('phone');
    const contactPerson = get('contactPerson');
    const email = get('email');
    const address = get('address');
    const taxNumber = get('taxNumber');
    const categoryText = get('category');
    const openingBalanceText = get('openingBalance');

    if (!name && !phoneText && !contactPerson && !email && !address && !taxNumber && !categoryText && !openingBalanceText) continue;

    const rowNumber = i + 1;
    const base = {
      rowNumber, name, phoneText, contactPerson, email, address, taxNumber, categoryText, openingBalanceText,
    };

    if (!name) {
      parsed.push({ ...base, status: 'invalid', reason: reasons.invalid });
      continue;
    }

    const formattedPhone = formatSaudiPhone(phoneText);
    if (!phoneText || !PHONE_REGEX.test(formattedPhone)) {
      parsed.push({ ...base, status: 'invalid', reason: reasons.invalid });
      continue;
    }

    if (email && !EMAIL_REGEX.test(email)) {
      parsed.push({ ...base, status: 'invalid', reason: reasons.invalid });
      continue;
    }

    if (taxNumber && !/^\d{15}$/.test(taxNumber)) {
      parsed.push({ ...base, status: 'invalid', reason: reasons.invalid });
      continue;
    }

    const matchedCategory = categoryOptions.find((c) => c.label.trim().toLowerCase() === categoryText.trim().toLowerCase());
    if (!categoryText || !matchedCategory) {
      parsed.push({ ...base, status: 'invalid', reason: reasons.unknownCategory });
      continue;
    }

    const openingBalance = openingBalanceText ? Number(openingBalanceText) : 0;
    if (!Number.isFinite(openingBalance) || openingBalance < 0) {
      parsed.push({ ...base, status: 'invalid', reason: reasons.invalid });
      continue;
    }

    if (existingPhones.has(formattedPhone)) {
      parsed.push({ ...base, status: 'duplicate_existing', reason: reasons.duplicateExisting });
      continue;
    }
    if (seenPhones.has(formattedPhone)) {
      parsed.push({ ...base, status: 'duplicate_in_file', reason: reasons.duplicateInFile });
      continue;
    }
    seenPhones.add(formattedPhone);

    parsed.push({
      ...base,
      status: 'valid',
      resolved: {
        name, phone: formattedPhone, contactPerson, email, address, taxNumber,
        categoryKey: matchedCategory.value, openingBalance,
      },
    });
  }

  return parsed;
}
