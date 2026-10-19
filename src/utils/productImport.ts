export const PRODUCT_IMPORT_COLUMN_FIELDS = [
  'name', 'price', 'category', 'sku', 'barcode', 'unit', 'conversionRate', 'costPrice', 'taxType', 'minThreshold',
] as const;
export type ProductImportField = (typeof PRODUCT_IMPORT_COLUMN_FIELDS)[number];

/** Same fallback-alias rationale as customerImport.ts's CUSTOMER_IMPORT_COLUMN_ALIASES. */
export const PRODUCT_IMPORT_COLUMN_ALIASES: Record<ProductImportField, string[]> = {
  name: ['الاسم', 'اسم المنتج', 'Name'],
  price: ['سعر البيع', 'السعر', 'Price'],
  category: ['التصنيف', 'الفئة', 'Category'],
  sku: ['رمز المنتج SKU', 'SKU', 'رمز المنتج'],
  barcode: ['الباركود', 'Barcode'],
  unit: ['الوحدة', 'Unit'],
  conversionRate: ['معدّل التحويل', 'Conversion Rate'],
  costPrice: ['سعر التكلفة', 'Cost Price'],
  taxType: ['نوع الضريبة', 'Tax Type'],
  minThreshold: ['حد التنبيه الأدنى', 'Min Threshold'],
};

export const PRODUCT_IMPORT_UNIT_ALIASES: Record<string, string[]> = {
  meter: ['متر', 'meter', 'm'],
  yard: ['ياردة', 'yard'],
  roll: ['طاقة / لفة', 'طاقة', 'لفة', 'roll'],
  bolt: ['طاقة (bolt)', 'bolt'],
  piece: ['قطعة', 'piece', 'pc'],
  spool: ['بكرة', 'spool'],
  box: ['صندوق (box)', 'صندوق', 'box'],
};

export const PRODUCT_IMPORT_TAX_TYPE_ALIASES: Record<string, string[]> = {
  inclusive: ['شامل الضريبة', 'شامل', 'inclusive'],
  exclusive: ['غير شامل', 'exclusive'],
  exempt: ['معفى من الضريبة', 'معفى', 'exempt'],
};

export interface ProductImportRow {
  rowNumber: number;
  name: string;
  priceText: string;
  categoryText: string;
  skuText: string;
  barcodeText: string;
  unitText: string;
  conversionRateText: string;
  costPriceText: string;
  taxTypeText: string;
  minThresholdText: string;
  status: 'valid' | 'duplicate_existing' | 'duplicate_in_file' | 'invalid';
  reason?: string;
  resolved?: {
    name: string;
    price: number;
    categoryKey: string;
    sku: string;
    barcode: string;
    unit: string;
    conversionRate: number;
    costPrice: number;
    taxType: 'inclusive' | 'exclusive' | 'exempt';
    minThreshold: number;
  };
}

export function mapProductImportHeaders(
  headerRow: string[],
  translatedAliases: Partial<Record<ProductImportField, string>> = {}
): Partial<Record<ProductImportField, number>> {
  const normalizedHeader = headerRow.map((h) => String(h ?? '').trim().toLowerCase());
  const colIndex: Partial<Record<ProductImportField, number>> = {};
  PRODUCT_IMPORT_COLUMN_FIELDS.forEach((field) => {
    const aliases = [translatedAliases[field], ...PRODUCT_IMPORT_COLUMN_ALIASES[field]]
      .filter((a): a is string => !!a)
      .map((a) => a.trim().toLowerCase());
    const idx = normalizedHeader.findIndex((h) => aliases.includes(h));
    if (idx !== -1) colIndex[field] = idx;
  });
  return colIndex;
}

function matchAlias(text: string, aliases: Record<string, string[]>): string | null {
  const normalized = text.trim().toLowerCase();
  for (const [key, values] of Object.entries(aliases)) {
    if (values.some((v) => v.toLowerCase() === normalized)) return key;
  }
  return null;
}

function generateRandomSku(): string {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

function generateRandomBarcode(): string {
  return Math.random().toString().substring(2, 12);
}

/**
 * مراجعة-الفريق-التقني-الكامل-2026-10-19.md جلسة brainstorming (المنتجات،
 * ثاني كيان من ثلاثة) -- بخلاف العملاء، inventory_items.sku/barcode لهما
 * قيد تكرار فعلي في قاعدة البيانات (uq_inventory_items_tenant_sku،
 * uq_inventory_items_tenant_barcode) -- فحص التكرار هنا ليس مجرد تحسين UX
 * بل ضروري لتفادي فشل الإدراج بصمت. كل منتج جديد يُنشأ برصيد صفر دائماً في
 * كل الفروع (قرار معماري متعمَّد سابق، seen-fields-categories-referral-task.md
 * #3) -- الرصيد الحقيقي يُضاف لاحقاً عبر أداة "الرصيد الافتتاحي" الموجودة
 * فعلاً (تربط بالـSKU)، فلا حاجة لعمود رصيد هنا إطلاقاً.
 */
export function parseProductImportRows(
  raw: any[][],
  colIndex: Partial<Record<ProductImportField, number>>,
  categoryOptions: { value: string; label: string }[],
  existingSkus: Set<string>,
  existingBarcodes: Set<string>,
  reasons: {
    invalid: string;
    duplicateSku: string;
    duplicateBarcode: string;
    unknownCategory: string;
    unknownUnit: string;
    unknownTaxType: string;
  }
): ProductImportRow[] {
  const seenSkus = new Set<string>();
  const seenBarcodes = new Set<string>();
  const parsed: ProductImportRow[] = [];

  const nextUniqueSku = (): string => {
    let candidate = generateRandomSku();
    while (existingSkus.has(candidate) || seenSkus.has(candidate)) candidate = generateRandomSku();
    return candidate;
  };
  const nextUniqueBarcode = (): string => {
    let candidate = generateRandomBarcode();
    while (existingBarcodes.has(candidate) || seenBarcodes.has(candidate)) candidate = generateRandomBarcode();
    return candidate;
  };

  for (let i = 1; i < raw.length; i++) {
    const rawRow = raw[i] || [];
    const get = (field: ProductImportField): string => {
      const idx = colIndex[field];
      return idx === undefined ? '' : String(rawRow[idx] ?? '').trim();
    };

    const name = get('name');
    const priceText = get('price');
    const categoryText = get('category');
    const skuText = get('sku');
    const barcodeText = get('barcode');
    const unitText = get('unit');
    const conversionRateText = get('conversionRate');
    const costPriceText = get('costPrice');
    const taxTypeText = get('taxType');
    const minThresholdText = get('minThreshold');

    if (!name && !priceText && !categoryText && !skuText && !barcodeText && !unitText
      && !conversionRateText && !costPriceText && !taxTypeText && !minThresholdText) continue;

    const rowNumber = i + 1;
    const base = {
      rowNumber, name, priceText, categoryText, skuText, barcodeText,
      unitText, conversionRateText, costPriceText, taxTypeText, minThresholdText,
    };

    if (!name) {
      parsed.push({ ...base, status: 'invalid', reason: reasons.invalid });
      continue;
    }

    const price = Number(priceText);
    if (!priceText || !Number.isFinite(price) || price <= 0) {
      parsed.push({ ...base, status: 'invalid', reason: reasons.invalid });
      continue;
    }

    const matchedCategory = categoryOptions.find((c) => c.label.trim().toLowerCase() === categoryText.trim().toLowerCase());
    if (!categoryText || !matchedCategory) {
      parsed.push({ ...base, status: 'invalid', reason: reasons.unknownCategory });
      continue;
    }

    let unit = 'piece';
    if (unitText) {
      const matched = matchAlias(unitText, PRODUCT_IMPORT_UNIT_ALIASES);
      if (!matched) {
        parsed.push({ ...base, status: 'invalid', reason: reasons.unknownUnit });
        continue;
      }
      unit = matched;
    }

    let taxType: 'inclusive' | 'exclusive' | 'exempt' = 'exclusive';
    if (taxTypeText) {
      const matched = matchAlias(taxTypeText, PRODUCT_IMPORT_TAX_TYPE_ALIASES);
      if (!matched) {
        parsed.push({ ...base, status: 'invalid', reason: reasons.unknownTaxType });
        continue;
      }
      taxType = matched as 'inclusive' | 'exclusive' | 'exempt';
    }

    const conversionRate = conversionRateText ? Number(conversionRateText) : 1;
    if (!Number.isFinite(conversionRate) || conversionRate <= 0) {
      parsed.push({ ...base, status: 'invalid', reason: reasons.invalid });
      continue;
    }

    const costPrice = costPriceText ? Number(costPriceText) : 0;
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      parsed.push({ ...base, status: 'invalid', reason: reasons.invalid });
      continue;
    }

    const minThreshold = minThresholdText ? Number(minThresholdText) : 0;
    if (!Number.isFinite(minThreshold) || minThreshold < 0) {
      parsed.push({ ...base, status: 'invalid', reason: reasons.invalid });
      continue;
    }

    let sku = skuText.replace(/\D/g, '');
    if (!sku) {
      sku = nextUniqueSku();
    } else if (existingSkus.has(sku)) {
      parsed.push({ ...base, status: 'duplicate_existing', reason: reasons.duplicateSku });
      continue;
    } else if (seenSkus.has(sku)) {
      parsed.push({ ...base, status: 'duplicate_in_file', reason: reasons.duplicateSku });
      continue;
    }

    let barcode = barcodeText;
    if (!barcode) {
      barcode = nextUniqueBarcode();
    } else if (existingBarcodes.has(barcode)) {
      parsed.push({ ...base, status: 'duplicate_existing', reason: reasons.duplicateBarcode });
      continue;
    } else if (seenBarcodes.has(barcode)) {
      parsed.push({ ...base, status: 'duplicate_in_file', reason: reasons.duplicateBarcode });
      continue;
    }

    seenSkus.add(sku);
    seenBarcodes.add(barcode);

    parsed.push({
      ...base,
      status: 'valid',
      resolved: {
        name, price, categoryKey: matchedCategory.value, sku, barcode,
        unit, conversionRate, costPrice, taxType, minThreshold,
      },
    });
  }

  return parsed;
}
