import { describe, it, expect } from 'vitest';
import { mapProductImportHeaders, parseProductImportRows, writeProductImportRows, type ProductImportRow } from './productImport';

const reasons = {
  invalid: 'بيانات غير صالحة',
  duplicateSku: 'رمز منتج مكرر',
  duplicateBarcode: 'باركود مكرر',
  unknownCategory: 'تصنيف غير معروف',
  unknownUnit: 'وحدة غير معروفة',
  unknownTaxType: 'نوع ضريبة غير معروف',
};

const categoryOptions = [
  { value: 'fabric', label: 'أقمشة' },
  { value: 'ready_made', label: 'جاهز' },
];

const header = ['الاسم', 'سعر البيع', 'التصنيف', 'SKU', 'الباركود', 'الوحدة', 'معدّل التحويل', 'سعر التكلفة', 'نوع الضريبة', 'حد التنبيه الأدنى'];
const colIndex = {
  name: 0, price: 1, category: 2, sku: 3, barcode: 4,
  unit: 5, conversionRate: 6, costPrice: 7, taxType: 8, minThreshold: 9,
};

describe('mapProductImportHeaders', () => {
  it('matches all ten columns by their Arabic header', () => {
    expect(mapProductImportHeaders(header)).toEqual(colIndex);
  });

  it('matches English aliases', () => {
    const idx = mapProductImportHeaders(['Name', 'Price', 'Category']);
    expect(idx).toEqual({ name: 0, price: 1, category: 2 });
  });
});

describe('parseProductImportRows', () => {
  it('accepts a fully-specified valid row', () => {
    const raw = [header, ['قميص أبيض', '120', 'جاهز', '12345678', '987654321', 'قطعة', '1', '80', 'شامل الضريبة', '5']];
    const rows = parseProductImportRows(raw, colIndex, categoryOptions, new Set(), new Set(), reasons);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'valid',
      resolved: {
        name: 'قميص أبيض', price: 120, categoryKey: 'ready_made', sku: '12345678',
        barcode: '987654321', unit: 'piece', conversionRate: 1, costPrice: 80,
        taxType: 'inclusive', minThreshold: 5,
      },
    });
  });

  it('defaults unit to piece, conversionRate to 1, costPrice/minThreshold to 0, taxType to exclusive when blank', () => {
    const raw = [header, ['قماش قطن', '50', 'أقمشة', '', '', '', '', '', '', '']];
    const rows = parseProductImportRows(raw, colIndex, categoryOptions, new Set(), new Set(), reasons);
    expect(rows[0].resolved).toMatchObject({ unit: 'piece', conversionRate: 1, costPrice: 0, taxType: 'exclusive', minThreshold: 0 });
  });

  it('auto-generates an 8-digit SKU and a barcode when both are blank', () => {
    const raw = [header, ['قماش قطن', '50', 'أقمشة', '', '', '', '', '', '', '']];
    const rows = parseProductImportRows(raw, colIndex, categoryOptions, new Set(), new Set(), reasons);
    expect(rows[0].resolved!.sku).toMatch(/^\d{8}$/);
    expect(rows[0].resolved!.barcode.length).toBeGreaterThan(0);
  });

  it('sanitizes a provided SKU to digits only', () => {
    const raw = [header, ['قماش قطن', '50', 'أقمشة', 'SKU-123-ABC', '', '', '', '', '', '']];
    const rows = parseProductImportRows(raw, colIndex, categoryOptions, new Set(), new Set(), reasons);
    expect(rows[0].resolved!.sku).toBe('123');
  });

  it('flags a row with no name as invalid', () => {
    const raw = [header, ['', '50', 'أقمشة', '', '', '', '', '', '', '']];
    const rows = parseProductImportRows(raw, colIndex, categoryOptions, new Set(), new Set(), reasons);
    expect(rows[0].status).toBe('invalid');
  });

  it('flags a missing or non-positive price as invalid', () => {
    const rawMissing = [header, ['قميص', '', 'أقمشة', '', '', '', '', '', '', '']];
    const rawZero = [header, ['قميص', '0', 'أقمشة', '', '', '', '', '', '', '']];
    expect(parseProductImportRows(rawMissing, colIndex, categoryOptions, new Set(), new Set(), reasons)[0].status).toBe('invalid');
    expect(parseProductImportRows(rawZero, colIndex, categoryOptions, new Set(), new Set(), reasons)[0].status).toBe('invalid');
  });

  it('flags a category that does not match any of the tenant\'s categories as invalid', () => {
    const raw = [header, ['قميص', '50', 'تصنيف-غير-موجود', '', '', '', '', '', '', '']];
    const rows = parseProductImportRows(raw, colIndex, categoryOptions, new Set(), new Set(), reasons);
    expect(rows[0]).toMatchObject({ status: 'invalid', reason: reasons.unknownCategory });
  });

  it('flags an unrecognized unit as invalid instead of silently defaulting', () => {
    const raw = [header, ['قميص', '50', 'أقمشة', '', '', 'وحدة غريبة', '', '', '', '']];
    const rows = parseProductImportRows(raw, colIndex, categoryOptions, new Set(), new Set(), reasons);
    expect(rows[0]).toMatchObject({ status: 'invalid', reason: reasons.unknownUnit });
  });

  it('flags an unrecognized tax type as invalid', () => {
    const raw = [header, ['قميص', '50', 'أقمشة', '', '', '', '', '', 'نوع غريب', '']];
    const rows = parseProductImportRows(raw, colIndex, categoryOptions, new Set(), new Set(), reasons);
    expect(rows[0]).toMatchObject({ status: 'invalid', reason: reasons.unknownTaxType });
  });

  it('flags a non-positive conversionRate as invalid', () => {
    const raw = [header, ['قميص', '50', 'أقمشة', '', '', '', '0', '', '', '']];
    const rows = parseProductImportRows(raw, colIndex, categoryOptions, new Set(), new Set(), reasons);
    expect(rows[0].status).toBe('invalid');
  });

  it('flags a provided SKU that already belongs to an existing product as duplicate_existing', () => {
    const raw = [header, ['قميص', '50', 'أقمشة', '11112222', '', '', '', '', '', '']];
    const rows = parseProductImportRows(raw, colIndex, categoryOptions, new Set(['11112222']), new Set(), reasons);
    expect(rows[0]).toMatchObject({ status: 'duplicate_existing', reason: reasons.duplicateSku });
  });

  it('flags the second occurrence of the same SKU within the file as duplicate_in_file', () => {
    const raw = [
      header,
      ['قميص أبيض', '50', 'أقمشة', '11112222', '', '', '', '', '', ''],
      ['قميص أسود', '60', 'أقمشة', '1111-2222', '', '', '', '', '', ''], // sanitizes to the same digits
    ];
    const rows = parseProductImportRows(raw, colIndex, categoryOptions, new Set(), new Set(), reasons);
    expect(rows[0].status).toBe('valid');
    expect(rows[1]).toMatchObject({ status: 'duplicate_in_file', reason: reasons.duplicateSku });
  });

  it('flags a provided barcode that already belongs to an existing product as duplicate_existing', () => {
    const raw = [header, ['قميص', '50', 'أقمشة', '', '999', '', '', '', '', '']];
    const rows = parseProductImportRows(raw, colIndex, categoryOptions, new Set(), new Set(['999']), reasons);
    expect(rows[0]).toMatchObject({ status: 'duplicate_existing', reason: reasons.duplicateBarcode });
  });

  it('skips a fully blank row silently', () => {
    const raw = [header, ['', '', '', '', '', '', '', '', '', ''], ['قميص', '50', 'أقمشة', '', '', '', '', '', '', '']];
    const rows = parseProductImportRows(raw, colIndex, categoryOptions, new Set(), new Set(), reasons);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('قميص');
  });

  it('never generates a SKU that collides with an existing or already-seen one in this batch', () => {
    // Force the random generator into a tiny space so a collision is virtually guaranteed on repeated calls,
    // then verify every resolved SKU is still unique across the whole batch.
    const raw = [
      header,
      ...Array.from({ length: 20 }, (_, i) => [`منتج ${i}`, '10', 'أقمشة', '', '', '', '', '', '', '']),
    ];
    const rows = parseProductImportRows(raw, colIndex, categoryOptions, new Set(), new Set(), reasons);
    const skus = rows.map((r) => r.resolved!.sku);
    expect(new Set(skus).size).toBe(skus.length);
  });
});

function makeValidRow(overrides: Partial<ProductImportRow> = {}): ProductImportRow {
  return {
    rowNumber: 2, name: 'قميص', priceText: '50', categoryText: 'أقمشة', skuText: '', barcodeText: '',
    unitText: '', conversionRateText: '', costPriceText: '', taxTypeText: '', minThresholdText: '',
    status: 'valid',
    resolved: {
      name: 'قميص', price: 50, categoryKey: 'fabric', sku: '12345678', barcode: '1234567890',
      unit: 'piece', conversionRate: 1, costPrice: 0, taxType: 'exclusive', minThreshold: 0,
    },
    ...overrides,
  };
}

function makeSupabase(opts: {
  insertedItemIds?: string[];
  itemInsertErrorOnCall?: number;
  branchInventoryError?: { message: string } | null;
} = {}) {
  let itemCallIndex = 0;
  const branchInventoryInserts: any[] = [];
  const supabase = {
    from: (table: string) => {
      if (table === 'inventory_items') {
        return {
          insert: () => ({
            select: () => ({
              single: () => {
                itemCallIndex += 1;
                if (opts.itemInsertErrorOnCall === itemCallIndex) {
                  return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint' } });
                }
                const id = opts.insertedItemIds?.[itemCallIndex - 1] ?? `item-${itemCallIndex}`;
                return Promise.resolve({ data: { id }, error: null });
              },
            }),
          }),
        };
      }
      if (table === 'branch_inventory') {
        return {
          insert: (rows: any[]) => {
            branchInventoryInserts.push(rows);
            return Promise.resolve({ error: opts.branchInventoryError ?? null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return { supabase, branchInventoryInserts, getItemCallCount: () => itemCallIndex };
}

describe('writeProductImportRows', () => {
  it('inserts one inventory_items row per valid row, then a single batched branch_inventory insert for every branch of every created item', async () => {
    const { supabase, branchInventoryInserts, getItemCallCount } = makeSupabase({ insertedItemIds: ['item-1', 'item-2'] });
    const rows = [makeValidRow({ rowNumber: 2 }), makeValidRow({ rowNumber: 3, name: 'بنطال' })];
    const branches = [{ id: 'branch-1' }, { id: 'branch-2' }];

    const result = await writeProductImportRows(supabase, rows, branches, 'tenant-1', 'بيانات غير صالحة');

    expect(result).toEqual({ succeeded: 2, failures: [], branchInventoryError: null });
    expect(getItemCallCount()).toBe(2);
    expect(branchInventoryInserts).toHaveLength(1); // one batched call, not one per row
    expect(branchInventoryInserts[0]).toHaveLength(4); // 2 items x 2 branches
  });

  it("a single row's insert failure only fails that row, not the rest of the import", async () => {
    const { supabase, branchInventoryInserts, getItemCallCount } = makeSupabase({ itemInsertErrorOnCall: 1 });
    const rows = [makeValidRow({ rowNumber: 2 }), makeValidRow({ rowNumber: 3, name: 'بنطال' })];
    const branches = [{ id: 'branch-1' }];

    const result = await writeProductImportRows(supabase, rows, branches, 'tenant-1', 'بيانات غير صالحة');

    expect(result.succeeded).toBe(1);
    expect(result.failures).toEqual([
      { rowNumber: 2, name: 'قميص', skuText: '', reason: 'duplicate key value violates unique constraint' },
    ]);
    expect(getItemCallCount()).toBe(2); // the second row was still attempted
    expect(branchInventoryInserts[0]).toHaveLength(1); // only the surviving item's branch row
  });

  it('reports a batched branch_inventory failure separately, without marking the already-created item as failed', async () => {
    const { supabase } = makeSupabase({ branchInventoryError: { message: 'insert failed' } });
    const rows = [makeValidRow()];
    const branches = [{ id: 'branch-1' }];

    const result = await writeProductImportRows(supabase, rows, branches, 'tenant-1', 'بيانات غير صالحة');

    expect(result.succeeded).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.branchInventoryError).toBe('insert failed');
  });

  it('never calls branch_inventory when there are no branches', async () => {
    const { supabase, branchInventoryInserts } = makeSupabase();
    const result = await writeProductImportRows(supabase, [makeValidRow()], [], 'tenant-1', 'بيانات غير صالحة');

    expect(result.succeeded).toBe(1);
    expect(branchInventoryInserts).toHaveLength(0);
    expect(result.branchInventoryError).toBeNull();
  });
});
