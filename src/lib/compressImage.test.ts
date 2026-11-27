// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { compressForOrder, compressForVariant, OrderImageError, ORDER_IMAGE_STEPS, VARIANT_IMAGE_TARGET_BYTES } from './compressImage';

// seen-order-images-upload-task.md, phase 2: the smallest file that stays
// clear -- 1600px, WebP, 0.8 down to a floor of 0.6 / 1280px; never below.

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const photo = (size = 4_000_000, name = 'IMG_0001.jpg', type = 'image/jpeg') => {
  const f = new File([jpegBytes], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const blobOf = (kb: number, type = 'image/webp') => {
  const b = new Blob([new Uint8Array(4)], { type });
  Object.defineProperty(b, 'size', { value: kb * 1024 });
  return b;
};

describe('compressForOrder', () => {
  it('a 4 MB phone photo: the first step that reaches 250 KB, as WebP at 1600px', async () => {
    const compress = vi.fn()
      .mockResolvedValueOnce(blobOf(320)) // 1600 @ 0.8
      .mockResolvedValueOnce(blobOf(240)); // 1600 @ 0.7
    const out = await compressForOrder(photo(), { compress, supportsWebp: () => true });
    expect(out.size).toBe(240 * 1024);
    expect(compress).toHaveBeenCalledTimes(2);
    expect(compress.mock.calls[0][1]).toMatchObject({ maxWidthOrHeight: 1600, initialQuality: 0.8, fileType: 'image/webp', useWebWorker: true });
  });

  it('never below the floor: quality 0.6 and 1280px; if still over 250 KB it is kept, clarity first', async () => {
    const compress = vi.fn().mockResolvedValue(blobOf(380));
    const out = await compressForOrder(photo(), { compress, supportsWebp: () => true });
    expect(out.size).toBe(380 * 1024);
    const steps = compress.mock.calls.map((c) => c[1]);
    expect(Math.min(...steps.map((s) => s.initialQuality))).toBe(0.6);
    expect(Math.min(...steps.map((s) => s.maxWidthOrHeight))).toBe(1280);
    expect(steps).toHaveLength(ORDER_IMAGE_STEPS.length);
  });

  it('a small image is re-encoded once anyway (that drops its EXIF, GPS included)', async () => {
    const compress = vi.fn().mockResolvedValue(blobOf(90));
    await compressForOrder(photo(120_000), { compress, supportsWebp: () => true });
    expect(compress).toHaveBeenCalledTimes(1);
  });

  it('a browser that cannot make WebP gets JPEG with the same steps', async () => {
    const compress = vi.fn().mockResolvedValue(blobOf(200, 'image/jpeg'));
    await compressForOrder(photo(), { compress, supportsWebp: () => false });
    expect(compress.mock.calls[0][1]).toMatchObject({ fileType: 'image/jpeg' });
  });

  it('refuses over 25 MB, HEIC, and anything that is not an image', async () => {
    const compress = vi.fn();
    // A real 26 MB file (a size override on a File does not hold everywhere).
    const big = new File([jpegBytes, new Uint8Array(26 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
    await expect(compressForOrder(big, { compress, supportsWebp: () => true })).rejects.toMatchObject({ code: 'too_large' });
    await expect(compressForOrder(photo(2_000_000, 'IMG.HEIC', 'image/heic'), { compress, supportsWebp: () => true })).rejects.toMatchObject({ code: 'heic' });
    const text = new File([new Uint8Array([0x3c, 0x73, 0x76, 0x67])], 'x.svg', { type: 'image/svg+xml' });
    await expect(compressForOrder(text, { compress, supportsWebp: () => true })).rejects.toBeInstanceOf(OrderImageError);
    expect(compress).not.toHaveBeenCalled();
  });
});

// seen-product-variants-barcode-po-price-task.md, phase 2: a variant's photo
// is a small square in the POS -- 800px WebP, at most 150 KB, always.
describe('compressForVariant', () => {
  it('800px WebP, the first step that reaches 150 KB', async () => {
    const compress = vi.fn().mockResolvedValueOnce(blobOf(90));
    const out = await compressForVariant(photo(), { compress, supportsWebp: () => true });
    expect(out.size).toBe(90 * 1024);
    expect(compress.mock.calls[0][1]).toMatchObject({ maxWidthOrHeight: 800, fileType: 'image/webp' });
  });

  it('never over 150 KB: when the steps do not get there, the library is asked for 150 KB', async () => {
    const compress = vi.fn().mockImplementation(async (_f, o) => (o.alwaysKeepResolution ? blobOf(400) : blobOf(140)));
    const out = await compressForVariant(photo(), { compress, supportsWebp: () => true });
    expect(out.size).toBeLessThanOrEqual(VARIANT_IMAGE_TARGET_BYTES);
    const last = compress.mock.calls.at(-1)![1];
    expect(last.maxSizeMB).toBeLessThanOrEqual(150 / 1024);
  });

  it('HEIC is refused like an order photo', async () => {
    await expect(compressForVariant(photo(1000, 'a.heic', 'image/heic'), { compress: vi.fn(), supportsWebp: () => true }))
      .rejects.toBeInstanceOf(OrderImageError);
  });
});
