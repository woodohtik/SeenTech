// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { uploadVariantImage } from './variantImages';

// seen-product-variants-barcode-po-price-task.md, phase 2: a variant photo
// goes to products/<shop>/variants/ and a failed upload is an error to retry
// -- never Base64 in the database.
const blob = new Blob([new Uint8Array(8)], { type: 'image/webp' });

describe('uploadVariantImage', () => {
  it("goes to the shop's variants folder and returns its link", async () => {
    const upload = vi.fn().mockResolvedValue('https://cdn.example/x.webp');
    const url = await uploadVariantImage(blob, 'tenant-1', { upload });
    expect(url).toBe('https://cdn.example/x.webp');
    expect(upload.mock.calls[0][0]).toMatch(/^products\/tenant-1\/variants\/[0-9a-f-]{36}\.webp$/);
  });

  it('a failed upload throws -- no Base64', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('network'));
    await expect(uploadVariantImage(blob, 'tenant-1', { upload })).rejects.toThrow();
  });
});
