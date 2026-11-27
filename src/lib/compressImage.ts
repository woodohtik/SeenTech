import { isAllowedImageFile } from './imageValidation';

/**
 * An order photo, as small as it can be while the embroidery, the collar and
 * the cut stay clear (seen-order-images-upload-task.md, phase 2).
 *
 * Steps from 1600px at quality 0.8 down to a floor of 0.6 at 1280px -- never
 * below: the first result at or under 250 KB is taken; if none gets there the
 * floor's is kept, because a clear photo matters more than a small one.
 * Every photo is drawn again (even a small one), which drops its EXIF --
 * the GPS position included.
 */

export const ORDER_IMAGE_TARGET_BYTES = 250 * 1024;
export const ORDER_IMAGE_MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const ORDER_IMAGE_STEPS: ReadonlyArray<{ side: number; quality: number }> = [
  { side: 1600, quality: 0.8 },
  { side: 1600, quality: 0.7 },
  { side: 1440, quality: 0.65 },
  { side: 1280, quality: 0.6 },
];

export type OrderImageErrorCode = 'too_large' | 'heic' | 'not_image' | 'compress_failed';

export class OrderImageError extends Error {
  constructor(public code: OrderImageErrorCode) {
    super(code);
    this.name = 'OrderImageError';
  }
}

export interface CompressOptions {
  maxWidthOrHeight: number;
  initialQuality: number;
  maxSizeMB: number;
  fileType: 'image/webp' | 'image/jpeg';
  useWebWorker: boolean;
  alwaysKeepResolution: boolean;
}

export interface CompressDeps {
  compress: (file: File, options: CompressOptions) => Promise<Blob>;
  supportsWebp: () => boolean;
}

/** Whether this browser can make a WebP (some older Safari cannot). */
export function browserMakesWebp(): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    return canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

const defaultDeps: CompressDeps = {
  compress: async (file, options) => {
    const { default: imageCompression } = await import('browser-image-compression');
    return imageCompression(file, options);
  },
  supportsWebp: browserMakesWebp,
};

const isHeic = (file: File) => /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

export async function compressForOrder(file: File, deps: CompressDeps = defaultDeps): Promise<Blob> {
  if (file.size > ORDER_IMAGE_MAX_INPUT_BYTES) throw new OrderImageError('too_large');
  if (isHeic(file)) throw new OrderImageError('heic');
  if (!(await isAllowedImageFile(file))) throw new OrderImageError('not_image');

  const fileType = deps.supportsWebp() ? 'image/webp' : 'image/jpeg';
  let last: Blob | null = null;
  for (const step of ORDER_IMAGE_STEPS) {
    try {
      last = await deps.compress(file, {
        maxWidthOrHeight: step.side,
        initialQuality: step.quality,
        // One pass at this quality and size: the steps above do the stepping,
        // so the library never goes under the floor on its own.
        maxSizeMB: 10,
        fileType,
        useWebWorker: true,
        alwaysKeepResolution: true,
      });
    } catch {
      throw new OrderImageError('compress_failed');
    }
    if (last.size <= ORDER_IMAGE_TARGET_BYTES) return last;
  }
  if (!last) throw new OrderImageError('compress_failed');
  return last;
}

/**
 * A variant's photo (seen-product-variants-barcode-po-price-task.md, phase
 * 2): a small square in the POS and the stock list -- 800px WebP, never more
 * than 150 KB. The same checks as an order photo (size, HEIC, real image).
 */
export const VARIANT_IMAGE_TARGET_BYTES = 150 * 1024;
export const VARIANT_IMAGE_STEPS: ReadonlyArray<{ side: number; quality: number }> = [
  { side: 800, quality: 0.8 },
  { side: 800, quality: 0.7 },
  { side: 720, quality: 0.65 },
];

export async function compressForVariant(file: File, deps: CompressDeps = defaultDeps): Promise<Blob> {
  if (file.size > ORDER_IMAGE_MAX_INPUT_BYTES) throw new OrderImageError('too_large');
  if (isHeic(file)) throw new OrderImageError('heic');
  if (!(await isAllowedImageFile(file))) throw new OrderImageError('not_image');

  const fileType = deps.supportsWebp() ? 'image/webp' : 'image/jpeg';
  try {
    for (const step of VARIANT_IMAGE_STEPS) {
      const out = await deps.compress(file, {
        maxWidthOrHeight: step.side, initialQuality: step.quality, maxSizeMB: 10,
        fileType, useWebWorker: true, alwaysKeepResolution: true,
      });
      if (out.size <= VARIANT_IMAGE_TARGET_BYTES) return out;
    }
    // A busy pattern can stay big: let the library shrink it to the limit.
    const out = await deps.compress(file, {
      maxWidthOrHeight: 800, initialQuality: 0.6, maxSizeMB: (VARIANT_IMAGE_TARGET_BYTES - 4 * 1024) / (1024 * 1024),
      fileType, useWebWorker: true, alwaysKeepResolution: false,
    });
    if (out.size > VARIANT_IMAGE_TARGET_BYTES) throw new OrderImageError('compress_failed');
    return out;
  } catch (e) {
    if (e instanceof OrderImageError) throw e;
    throw new OrderImageError('compress_failed');
  }
}
