import { describe, expect, it, vi } from 'vitest';
import { ean13CheckDigit, generateInternalBarcode, isValidEan13 } from './barcode';

// seen-product-variants-barcode-po-price-task.md, phase 1: a barcode any
// scanner reads -- EAN-13 with its check digit, in the in-store range "2",
// never one the shop already uses.

describe('EAN-13', () => {
  it('the check digit of a known code', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1); // 4006381333931
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
  });
});

describe('generateInternalBarcode', () => {
  it('13 digits, starting with 2, a valid check digit', async () => {
    const code = await generateInternalBarcode({ isAvailable: async () => true });
    expect(code).toMatch(/^2\d{12}$/);
    expect(isValidEan13(code)).toBe(true);
  });

  it('a code the shop already uses is skipped', async () => {
    const isAvailable = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    const code = await generateInternalBarcode({ isAvailable });
    expect(isAvailable).toHaveBeenCalledTimes(3);
    expect(isValidEan13(code)).toBe(true);
  });

  it('gives up with an error rather than a duplicate', async () => {
    await expect(generateInternalBarcode({ isAvailable: async () => false })).rejects.toThrow();
  });
});
