// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// seen-permissions-fix-task.md Phase 6.
const subscribed: Array<{ table: string; filter: string; cb: () => void }> = [];
let removed = 0;
vi.mock('../lib/supabase/client', () => {
  const channel: any = {
    on: (_t: string, opts: any, cb: () => void) => { subscribed.push({ table: opts.table, filter: opts.filter, cb }); return channel; },
    subscribe: () => channel,
  };
  return { supabase: { channel: () => channel, removeChannel: async () => { removed++; } } };
});

import { usePermissionsLiveRefresh, PERMISSIONS_REFRESH_MS } from './usePermissionsLiveRefresh';

afterEach(() => { subscribed.length = 0; removed = 0; vi.useRealTimers(); });

describe('usePermissionsLiveRefresh', () => {
  test("watches the shop's roles and overrides (not staff) and announces a change", () => {
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('permissions_updated', on);
    const { unmount } = renderHook(() => usePermissionsLiveRefresh('shop-1'));
    expect(subscribed.map((s) => `${s.table}:${s.filter}`)).toEqual(['roles:tenant_id=eq.shop-1', 'user_permission_overrides:tenant_id=eq.shop-1']);
    subscribed[0].cb();
    expect(seen).toEqual([{ tenantId: 'shop-1' }]);
    unmount();
    expect(removed).toBe(1);
    window.removeEventListener('permissions_updated', on);
  });

  test('re-reads every 60 seconds while the page is visible', () => {
    vi.useFakeTimers();
    let count = 0;
    const on = () => { count++; };
    window.addEventListener('permissions_updated', on);
    const { unmount } = renderHook(() => usePermissionsLiveRefresh('shop-2'));
    vi.advanceTimersByTime(PERMISSIONS_REFRESH_MS);
    expect(count).toBe(1);
    expect(PERMISSIONS_REFRESH_MS).toBeLessThanOrEqual(60_000);
    unmount();
    window.removeEventListener('permissions_updated', on);
  });

  test('no shop, no subscription', () => {
    renderHook(() => usePermissionsLiveRefresh(null));
    expect(subscribed).toHaveLength(0);
  });
});
