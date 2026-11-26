// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const upload = vi.fn();
const createSignedUrls = vi.fn();
const remove = vi.fn();
const list = vi.fn();
vi.mock('./supabase/client', () => ({
  supabase: { storage: { from: () => ({ upload, createSignedUrls, remove, list }) } },
}));

import {
  ORDER_IMAGES_BUCKET, deleteOrderImage, deleteOrderImageFolder, getOrderImageUrls, isStoredOrderImagePath, uploadOrderImage,
} from './orderImages';

// seen-order-images-upload-task.md, phase 1: paths, not public links; signed
// links for an hour; no Base64 fallback ever.

const blob = new Blob([new Uint8Array(10)], { type: 'image/webp' });

beforeEach(() => { upload.mockReset(); createSignedUrls.mockReset(); remove.mockReset(); list.mockReset(); });

describe('order images', () => {
  it('upload: <tenant>/<order>/<uuid>.webp, returns the PATH', async () => {
    upload.mockResolvedValue({ data: { path: 'x' }, error: null });
    const path = await uploadOrderImage(blob, 't1', 'o1');
    expect(path).toMatch(/^t1\/o1\/[0-9a-f-]{36}\.webp$/);
    expect(upload).toHaveBeenCalledWith(path, blob, expect.objectContaining({ contentType: 'image/webp', upsert: false }));
    expect(ORDER_IMAGES_BUCKET).toBe('order-images');
  });

  it('a failed upload is an error -- never a Base64 copy', async () => {
    upload.mockResolvedValue({ data: null, error: { message: 'network' } });
    await expect(uploadOrderImage(blob, 't1', 'o1')).rejects.toThrow();
  });

  it('signed links for all of an order\'s images in one call, an hour, cached', async () => {
    createSignedUrls.mockResolvedValue({ data: [{ path: 'a', signedUrl: 'https://s/a' }, { path: 'b', signedUrl: 'https://s/b' }], error: null });
    expect(await getOrderImageUrls(['a', 'b'])).toEqual({ a: 'https://s/a', b: 'https://s/b' });
    expect(createSignedUrls).toHaveBeenCalledWith(['a', 'b'], 3600);
    expect(await getOrderImageUrls(['a'])).toEqual({ a: 'https://s/a' });
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
  });

  it('old images (links, Base64) are not storage paths', () => {
    expect(isStoredOrderImagePath('t1/o1/x.webp')).toBe(true);
    expect(isStoredOrderImagePath('https://x/y.jpg')).toBe(false);
    expect(isStoredOrderImagePath('data:image/png;base64,AAA')).toBe(false);
  });

  it('delete one, and an order\'s whole folder', async () => {
    remove.mockResolvedValue({ error: null });
    await deleteOrderImage('t1/o1/a.webp');
    expect(remove).toHaveBeenCalledWith(['t1/o1/a.webp']);
    list.mockResolvedValue({ data: [{ name: 'a.webp' }, { name: 'b.webp' }], error: null });
    await deleteOrderImageFolder('t1', 'o1');
    expect(remove).toHaveBeenLastCalledWith(['t1/o1/a.webp', 't1/o1/b.webp']);
  });
});
