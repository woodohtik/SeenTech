import { describe, expect, it, vi } from 'vitest';
import { removeTenantOrderImages } from './orderImagesCleanup';

// seen-order-images-upload-task.md, phase 5: a shop deleted for good (or its
// data wiped) leaves no order photos in storage.

function storage(tree: Record<string, string[]>) {
  const removed: string[][] = [];
  const api = {
    list: vi.fn(async (prefix: string) => ({ data: (tree[prefix] || []).map((name) => ({ name, id: name.includes('.') ? name : null })), error: null })),
    remove: vi.fn(async (paths: string[]) => { removed.push(paths); return { error: null }; }),
  };
  return { api, removed };
}

describe('removeTenantOrderImages', () => {
  it("removes every photo in every order folder of the shop, and counts them", async () => {
    const { api, removed } = storage({
      'aa000000-0000-4000-8000-000000000001': ['o1', 'o2'],
      'aa000000-0000-4000-8000-000000000001/o1': ['a.webp', 'b.webp'],
      'aa000000-0000-4000-8000-000000000001/o2': ['c.webp'],
    });
    const count = await removeTenantOrderImages(api as any, 'aa000000-0000-4000-8000-000000000001');
    expect(count).toBe(3);
    expect(removed.flat().sort()).toEqual(['aa000000-0000-4000-8000-000000000001/o1/a.webp', 'aa000000-0000-4000-8000-000000000001/o1/b.webp', 'aa000000-0000-4000-8000-000000000001/o2/c.webp']);
  });

  it('a shop with no photos: nothing removed', async () => {
    const { api } = storage({});
    expect(await removeTenantOrderImages(api as any, 'aa000000-0000-4000-8000-000000000009')).toBe(0);
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('refuses a tenant id that is not a uuid-like folder name (never the bucket root)', async () => {
    const { api } = storage({});
    await expect(removeTenantOrderImages(api as any, '')).rejects.toThrow();
    await expect(removeTenantOrderImages(api as any, '../x')).rejects.toThrow();
  });
});
