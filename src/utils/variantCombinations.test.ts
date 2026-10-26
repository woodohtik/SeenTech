import { describe, it, expect } from 'vitest';
import { generateVariantCombinations, type AttributeDraft } from './variantCombinations';

describe('generateVariantCombinations', () => {
  it('returns one combination per value for a single attribute', () => {
    const attributes: AttributeDraft[] = [{ name: 'اللون', values: ['أزرق', 'أخضر', 'أبيض'] }];

    const combos = generateVariantCombinations(attributes);

    expect(combos).toEqual([
      { name: 'أزرق', options: { 'اللون': 'أزرق' } },
      { name: 'أخضر', options: { 'اللون': 'أخضر' } },
      { name: 'أبيض', options: { 'اللون': 'أبيض' } },
    ]);
  });

  it('returns the cartesian product across multiple attributes, name joined with " - "', () => {
    const attributes: AttributeDraft[] = [
      { name: 'اللون', values: ['أزرق', 'أخضر'] },
      { name: 'المقاس', values: ['S', 'M'] },
    ];

    const combos = generateVariantCombinations(attributes);

    expect(combos).toEqual([
      { name: 'أزرق - S', options: { 'اللون': 'أزرق', 'المقاس': 'S' } },
      { name: 'أزرق - M', options: { 'اللون': 'أزرق', 'المقاس': 'M' } },
      { name: 'أخضر - S', options: { 'اللون': 'أخضر', 'المقاس': 'S' } },
      { name: 'أخضر - M', options: { 'اللون': 'أخضر', 'المقاس': 'M' } },
    ]);
  });

  it('returns an empty array when there are no attributes', () => {
    expect(generateVariantCombinations([])).toEqual([]);
  });

  it('ignores attributes with a blank name', () => {
    const attributes: AttributeDraft[] = [{ name: '   ', values: ['أزرق'] }];
    expect(generateVariantCombinations(attributes)).toEqual([]);
  });

  it('ignores attributes with no values', () => {
    const attributes: AttributeDraft[] = [{ name: 'اللون', values: [] }];
    expect(generateVariantCombinations(attributes)).toEqual([]);
  });

  it('trims whitespace from attribute names and values', () => {
    const attributes: AttributeDraft[] = [{ name: '  اللون  ', values: ['  أزرق  '] }];
    expect(generateVariantCombinations(attributes)).toEqual([
      { name: 'أزرق', options: { 'اللون': 'أزرق' } },
    ]);
  });
});
