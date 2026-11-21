import { describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/supabase/client', () => ({ supabase: {} }));

import { attributeEntries, lineSpecsText } from './OrderItemAttributes';
import { attachLineAttributes } from '../../services/taxInvoiceService';
import type { FieldSchema } from '../../types/expansion';

const f = (field_key: string, field_type: FieldSchema['field_type'], label_ar: string, extra: Partial<FieldSchema> = {}): FieldSchema => ({
  vertical_key: 'furniture', field_key, label_ar, field_type, applies_to: 'order_item', sort: 1, ...extra,
});

const furniture = [
  f('wood_type', 'select', 'نوع الخشب', { label_en: 'Wood type', options: ['زان', 'سويد'], options_i18n: { en: ['Beech', 'Swedish pine'] } }),
  f('width_cm', 'number', 'العرض (سم)', { label_en: 'Width (cm)' }),
  f('lining', 'bool', 'بطانة', { label_en: 'Lining' }),
  f('color', 'text', 'اللون', { label_en: 'Colour' }),
];

// seen-verticals-readiness-task.md Phase 3: the line specs are shown and printed.
describe('a line\'s specs', () => {
  test('in the schema order, translated, yes/no as ✓/✗, empty values hidden', () => {
    const attrs = { width_cm: 220, wood_type: 'زان', lining: false, color: '', quantityUnit: 'piece' };
    expect(attributeEntries(attrs, furniture, 'ar')).toEqual([
      { key: 'wood_type', label: 'نوع الخشب', value: 'زان' },
      { key: 'width_cm', label: 'العرض (سم)', value: '220' },
      { key: 'lining', label: 'بطانة', value: '✗' },
    ]);
    expect(lineSpecsText(attrs, furniture, 'en')).toBe('Wood type: Beech · Width (cm): 220 · Lining: ✗');
  });

  test("men's tailoring: its options are columns, not attributes -- nothing new to show", () => {
    const mens = [f('collar_type', 'select', 'نوع الياقة', { vertical_key: 'mens_tailoring', options: ['كلاسيكي'] })];
    expect(attributeEntries({ quantityUnit: 'piece', fabricManual: false, fabricPerPieceMeters: 0 }, mens, 'ar')).toEqual([]);
    expect(lineSpecsText(null, mens, 'ar')).toBe('');
  });
});

describe('an invoice\'s lines get the order lines\' specs', () => {
  test('in order, custom lines only', () => {
    const items = [{ type: 'custom', garmentType: 'كنب' }, { type: 'ready_made', name: 'وسادة' }, { type: 'custom', garmentType: 'كرسي' }];
    const out = attachLineAttributes(items, [{ attributes: { wood_type: 'زان' } }, { attributes: { wood_type: 'سويد' } }]);
    expect(out[0].attributes).toEqual({ wood_type: 'زان' });
    expect((out[1] as any).attributes).toBeUndefined();
    expect(out[2].attributes).toEqual({ wood_type: 'سويد' });
  });

  test('not when the counts differ (never another line\'s specs)', () => {
    const items = [{ type: 'custom' }, { type: 'custom' }];
    expect(attachLineAttributes(items, [{ attributes: { a: 1 } }])).toBe(items);
  });

  test('a line that already has attributes keeps them', () => {
    const items = [{ type: 'custom', attributes: { wood_type: 'زان' } }];
    expect(attachLineAttributes(items, [{ attributes: { wood_type: 'سويد' } }])[0].attributes).toEqual({ wood_type: 'زان' });
  });
});
