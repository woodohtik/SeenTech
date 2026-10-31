// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { test, expect, vi } from 'vitest';
import { useMeasurementUnit } from './useMeasurementUnit';

const maybeSingle = vi.fn();
vi.mock('../lib/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  },
}));

test('defaults to inch before the fetch resolves', () => {
  maybeSingle.mockReturnValue(new Promise(() => {})); // never resolves within this test
  const { result } = renderHook(() => useMeasurementUnit('tenant-1'));
  expect(result.current).toBe('inch');
});

test('switches to cm when the tenant has measurement_unit = cm', async () => {
  const promise = Promise.resolve({ data: { measurement_unit: 'cm' }, error: null });
  maybeSingle.mockReturnValue(promise);
  const { result } = renderHook(() => useMeasurementUnit('tenant-1'));
  await act(async () => {
    await promise;
  });
  expect(result.current).toBe('cm');
});

test('stays at inch on a query error', async () => {
  const promise = Promise.resolve({ data: null, error: { message: 'boom' } });
  maybeSingle.mockReturnValue(promise);
  const { result } = renderHook(() => useMeasurementUnit('tenant-1'));
  await act(async () => {
    await promise;
  });
  expect(result.current).toBe('inch');
});

test('stays at inch when the column value is null or unexpected', async () => {
  const promise = Promise.resolve({ data: { measurement_unit: null }, error: null });
  maybeSingle.mockReturnValue(promise);
  const { result } = renderHook(() => useMeasurementUnit('tenant-1'));
  await act(async () => {
    await promise;
  });
  expect(result.current).toBe('inch');
});

test('resets to inch when tenantId changes mid-mount, even after a prior tenant resolved to cm', async () => {
  const promiseA = Promise.resolve({ data: { measurement_unit: 'cm' }, error: null });
  maybeSingle.mockReturnValueOnce(promiseA);
  const promiseB = new Promise(() => {}); // tenant B's fetch never resolves within this test
  maybeSingle.mockReturnValueOnce(promiseB);

  const { result, rerender } = renderHook(
    ({ tenantId }) => useMeasurementUnit(tenantId),
    { initialProps: { tenantId: 'tenant-1' } }
  );

  await act(async () => {
    await promiseA;
  });
  expect(result.current).toBe('cm');

  rerender({ tenantId: 'tenant-2' });

  expect(result.current).toBe('inch');
});
