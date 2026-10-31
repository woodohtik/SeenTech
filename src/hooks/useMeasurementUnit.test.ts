// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
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
  maybeSingle.mockResolvedValue({ data: { measurement_unit: 'cm' }, error: null });
  const { result } = renderHook(() => useMeasurementUnit('tenant-1'));
  await waitFor(() => expect(result.current).toBe('cm'));
});

test('stays at inch on a query error', async () => {
  maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
  const { result } = renderHook(() => useMeasurementUnit('tenant-1'));
  await waitFor(() => expect(maybeSingle).toHaveBeenCalled());
  expect(result.current).toBe('inch');
});

test('stays at inch when the column value is null or unexpected', async () => {
  maybeSingle.mockResolvedValue({ data: { measurement_unit: null }, error: null });
  const { result } = renderHook(() => useMeasurementUnit('tenant-1'));
  await waitFor(() => expect(maybeSingle).toHaveBeenCalled());
  expect(result.current).toBe('inch');
});
