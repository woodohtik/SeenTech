import { beforeEach, expect, test, vi } from 'vitest';

const maybeSingle = vi.fn();
vi.mock('./supabase/client', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) },
}));

beforeEach(() => {
  vi.resetModules();
  maybeSingle.mockReset();
});

test('the opening burst reads the row once', async () => {
  maybeSingle.mockResolvedValue({ data: { id: 't1', name: 'محل' }, error: null });
  const { readTenantRow } = await import('./tenantRow');
  const [a, b, c] = await Promise.all([readTenantRow('t1'), readTenantRow('t1'), readTenantRow('t1')]);
  expect(maybeSingle).toHaveBeenCalledTimes(1);
  expect(a.data?.name).toBe('محل');
  expect(b).toEqual(a);
  expect(c).toEqual(a);
});

test('a row primed from the identity response needs no request', async () => {
  const { readTenantRow, primeTenantRow } = await import('./tenantRow');
  primeTenantRow('t2', { id: 't2', measurement_unit: 'cm' });
  const { data } = await readTenantRow('t2');
  expect(data?.measurement_unit).toBe('cm');
  expect(maybeSingle).not.toHaveBeenCalled();
});

test('a failed read is not kept: the next call asks again', async () => {
  maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'network' } })
    .mockResolvedValueOnce({ data: { id: 't3' }, error: null });
  const { readTenantRow } = await import('./tenantRow');
  expect((await readTenantRow('t3')).error).toBeTruthy();
  expect((await readTenantRow('t3')).data?.id).toBe('t3');
  expect(maybeSingle).toHaveBeenCalledTimes(2);
});

test('after 10 seconds the row is read fresh (a change saved in Settings shows)', async () => {
  vi.useFakeTimers();
  maybeSingle.mockResolvedValue({ data: { id: 't4' }, error: null });
  const { readTenantRow } = await import('./tenantRow');
  await readTenantRow('t4');
  vi.advanceTimersByTime(11_000);
  await readTenantRow('t4');
  expect(maybeSingle).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
