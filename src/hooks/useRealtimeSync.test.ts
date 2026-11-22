// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

// seen-readiness-fixes-task.md P3.4 (RELIABILITY-15).
const rt = vi.hoisted(() => ({ subscribe: null as null | ((s: string, e?: any) => void), draining: false }));
vi.mock('../lib/supabase/client', () => ({
  supabase: {
    channel: () => {
      const ch: any = { on: () => ch, subscribe: (cb: any) => { rt.subscribe = cb; return ch; } };
      return ch;
    },
    removeChannel: () => {},
  },
}));
vi.mock('../lib/offline/connectivity', () => ({ getIsOnline: () => true, onConnectivityChange: () => () => {} }));
vi.mock('../lib/offline/outbox', () => ({ OUTBOX_DRAINED_EVENT: 'seen-outbox-drained', isOutboxDraining: () => rt.draining }));

import { useRealtimeSync } from './useRealtimeSync';

test('after the live channel drops and comes back, the data is re-fetched once -- after the queue has synced', () => {
  const onResync = vi.fn();
  renderHook(() => useRealtimeSync('orders', 't1', () => {}, onResync));
  rt.subscribe!('SUBSCRIBED');
  expect(onResync).not.toHaveBeenCalled(); // the first subscription is not a resync

  rt.subscribe!('CHANNEL_ERROR', new Error('x'));
  rt.draining = true;
  rt.subscribe!('SUBSCRIBED');
  expect(onResync).not.toHaveBeenCalled(); // the queue is still sending
  rt.draining = false;
  window.dispatchEvent(new Event('seen-outbox-drained'));
  expect(onResync).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('seen-outbox-drained'));
  expect(onResync).toHaveBeenCalledTimes(1);
});
