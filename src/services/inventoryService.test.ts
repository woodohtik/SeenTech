import { test, expect, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
const rpcMock = vi.fn();
vi.mock('../lib/supabase/client', () => ({
  supabase: {
    from: (...args: any[]) => fromMock(...args),
    rpc: (...args: any[]) => rpcMock(...args),
  },
}));

import { checkStockAvailability, deductStock } from './inventoryService';

// Minimal chainable query-builder stand-in: every chain method returns the
// same object, and the object itself resolves (as a thenable) to `result`
// -- covers both `.in(...)` (awaited directly) and `.maybeSingle()` (the
// branches lookup) call shapes used by inventoryService.ts.
function chain(result: { data: any; error: any }) {
  const obj: any = {};
  obj.select = () => obj;
  obj.eq = () => obj;
  obj.in = () => obj;
  obj.maybeSingle = () => Promise.resolve(result);
  obj.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return obj;
}

function tableCallCount(table: string): number {
  return fromMock.mock.calls.filter(call => call[0] === table).length;
}

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

test('checkStockAvailability issues exactly one inventory_items query and one branch_inventory query, regardless of item count', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'inventory_items') {
      return chain({
        data: [
          { id: 'i1', name: 'قماش أ' },
          { id: 'i2', name: 'قماش ب' },
          { id: 'i3', name: 'قماش ج' },
        ],
        error: null,
      });
    }
    if (table === 'branch_inventory') {
      return chain({
        data: [
          { item_id: 'i1', quantity: 100 },
          { item_id: 'i2', quantity: 100 },
          { item_id: 'i3', quantity: 100 },
        ],
        error: null,
      });
    }
    throw new Error(`unexpected table: ${table}`);
  });

  const items = [
    { fabric: 'قماش أ', quantity: 1, selectedUnit: 'meter' },
    { fabric: 'قماش ب', quantity: 1, selectedUnit: 'meter' },
    { fabric: 'قماش ج', quantity: 1, selectedUnit: 'meter' },
  ];

  const result = await checkStockAvailability(items, 'branch-1', 'tenant-1', 'decentralized');

  expect(result).toEqual({ available: true, missingItems: [] });
  expect(tableCallCount('inventory_items')).toBe(1);
  expect(tableCallCount('branch_inventory')).toBe(1);
});

test('a fabric with no matching inventory_items row is reported missing', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'inventory_items') {
      return chain({ data: [{ id: 'i1', name: 'قماش أ' }], error: null });
    }
    if (table === 'branch_inventory') {
      return chain({ data: [{ item_id: 'i1', quantity: 100 }], error: null });
    }
    throw new Error(`unexpected table: ${table}`);
  });

  const items = [
    { fabric: 'قماش أ', quantity: 1, selectedUnit: 'meter' },
    { fabric: 'قماش غير موجود', quantity: 1, selectedUnit: 'meter' },
  ];

  const result = await checkStockAvailability(items, 'branch-1', 'tenant-1', 'decentralized');

  expect(result.available).toBe(false);
  expect(result.missingItems).toEqual(['قماش غير موجود']);
});

test('insufficient branch stock is reported missing', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'inventory_items') {
      return chain({ data: [{ id: 'i1', name: 'قماش أ' }], error: null });
    }
    if (table === 'branch_inventory') {
      return chain({ data: [{ item_id: 'i1', quantity: 2 }], error: null });
    }
    throw new Error(`unexpected table: ${table}`);
  });

  const items = [{ fabric: 'قماش أ', quantity: 5, selectedUnit: 'meter' }];

  const result = await checkStockAvailability(items, 'branch-1', 'tenant-1', 'decentralized');

  expect(result.available).toBe(false);
  expect(result.missingItems).toEqual(['قماش أ']);
});

test('centralized strategy resolves the main warehouse first, then still issues one batched query per table', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'branches') {
      return chain({ data: { id: 'main-branch' }, error: null });
    }
    if (table === 'inventory_items') {
      return chain({ data: [{ id: 'i1', name: 'قماش أ' }], error: null });
    }
    if (table === 'branch_inventory') {
      return chain({ data: [{ item_id: 'i1', quantity: 100 }], error: null });
    }
    throw new Error(`unexpected table: ${table}`);
  });

  const items = [{ fabric: 'قماش أ', quantity: 1, selectedUnit: 'meter' }];
  const result = await checkStockAvailability(items, 'branch-1', 'tenant-1', 'centralized');

  expect(result).toEqual({ available: true, missingItems: [] });
  expect(tableCallCount('branches')).toBe(1);
  expect(tableCallCount('inventory_items')).toBe(1);
  expect(tableCallCount('branch_inventory')).toBe(1);
});

test('centralized strategy with no main warehouse returns unavailable without querying items', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'branches') {
      return chain({ data: null, error: null });
    }
    throw new Error(`unexpected table: ${table}`);
  });

  const items = [{ fabric: 'قماش أ', quantity: 1, selectedUnit: 'meter' }];
  const result = await checkStockAvailability(items, 'branch-1', 'tenant-1', 'centralized');

  expect(result.available).toBe(false);
  expect(tableCallCount('inventory_items')).toBe(0);
  expect(tableCallCount('branch_inventory')).toBe(0);
});

test('deductStock issues one batched inventory_items query and one apply_stock_movement RPC call per item', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'inventory_items') {
      return chain({
        data: [
          { id: 'i1', name: 'قماش أ' },
          { id: 'i2', name: 'قماش ب' },
        ],
        error: null,
      });
    }
    throw new Error(`unexpected table: ${table}`);
  });
  rpcMock.mockResolvedValue({ error: null });

  const order = {
    id: 'order-1',
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    items: [
      { fabric: 'قماش أ', quantity: 2, selectedUnit: 'meter' },
      { fabric: 'قماش ب', quantity: 3, selectedUnit: 'meter' },
    ],
  } as any;
  const staff = { branchId: 'branch-1' } as any;

  await deductStock(order, staff, 'decentralized');

  expect(tableCallCount('inventory_items')).toBe(1);
  expect(rpcMock).toHaveBeenCalledTimes(2);
  expect(rpcMock).toHaveBeenCalledWith('apply_stock_movement', expect.objectContaining({
    p_operation_id: 'order:order-1:item:i1',
    p_item_id: 'i1',
    p_delta: -2,
  }));
  expect(rpcMock).toHaveBeenCalledWith('apply_stock_movement', expect.objectContaining({
    p_operation_id: 'order:order-1:item:i2',
    p_item_id: 'i2',
    p_delta: -3,
  }));
});

test('deductStock skips items with no matching inventory_items row, without calling the RPC for them', async () => {
  fromMock.mockImplementation((table: string) => {
    if (table === 'inventory_items') {
      return chain({ data: [{ id: 'i1', name: 'قماش أ' }], error: null });
    }
    throw new Error(`unexpected table: ${table}`);
  });
  rpcMock.mockResolvedValue({ error: null });

  const order = {
    id: 'order-1',
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    items: [
      { fabric: 'قماش أ', quantity: 2, selectedUnit: 'meter' },
      { fabric: 'قماش غير موجود', quantity: 1, selectedUnit: 'meter' },
    ],
  } as any;
  const staff = { branchId: 'branch-1' } as any;

  await deductStock(order, staff, 'decentralized');

  expect(rpcMock).toHaveBeenCalledTimes(1);
});
