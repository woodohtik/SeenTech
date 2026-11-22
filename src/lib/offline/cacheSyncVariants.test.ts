import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

// seen-readiness-fixes-task.md P3.4 (RELIABILITY-12): a product's sizes and
// colours keep their own stock in the offline cache.
const rows = [
  { branch_id: 'b1', item_id: 'shirt', variant_id: null, quantity: 9 },
  { branch_id: 'b1', item_id: 'shirt', variant_id: 'shirt-L', quantity: 4 },
  { branch_id: 'b1', item_id: 'shirt', variant_id: 'shirt-XL', quantity: 2 },
  { branch_id: 'b2', item_id: 'shirt', variant_id: 'shirt-L', quantity: 7 },
];
vi.mock('../supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: rows, error: null }) }) }) },
}));

import { getCachedBranchStock, getCachedVariantStock, refreshBranchStockCache } from './cacheSync';

describe('the offline stock cache', () => {
  it('keeps each variant apart from the others and from the item', async () => {
    await refreshBranchStockCache('t1');
    expect(await getCachedBranchStock('t1', 'b1')).toEqual({ shirt: 9 });
    expect(await getCachedVariantStock('t1', 'b1')).toEqual({ 'shirt-L': 4, 'shirt-XL': 2 });
    expect(await getCachedVariantStock('t1', 'b2')).toEqual({ 'shirt-L': 7 });
  });
});
