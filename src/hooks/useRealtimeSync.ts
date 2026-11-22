import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase/client';
import { decodeOrderRow } from '../utils/orderHistoryHelper';
import { getIsOnline, onConnectivityChange } from '../lib/offline/connectivity';
import { OUTBOX_DRAINED_EVENT, isOutboxDraining } from '../lib/offline/outbox';

/**
 * A custom hook to synchronize Supabase tables in real-time.
 *
 * @param table The name of the table to listen to (e.g., 'orders', 'inventory_items').
 * @param tenantId The current user's tenant ID, used to isolate data strictly to their tenant.
 * @param onUpdate The callback function that runs when an INSERT, UPDATE, or DELETE payload arrives.
 * @param onResync seen-readiness-fixes-task.md P3.4 (RELIABILITY-15): called once
 *   after the live channel or the connection dropped and came back -- events
 *   sent meanwhile are lost, so the caller re-fetches. It runs after the
 *   offline queue has finished sending, so the fresh data already has this
 *   device's own offline sales and orders.
 */
export function useRealtimeSync(table: string, tenantId: string | undefined, onUpdate: (payload: any) => void, onResync?: () => void) {
  const onUpdateRef = useRef(onUpdate);
  const onResyncRef = useRef(onResync);
  const needsResync = useRef(false);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
    onResyncRef.current = onResync;
  });

  useEffect(() => {
    if (!tenantId) return;

    const resync = () => {
      if (!needsResync.current || !getIsOnline() || isOutboxDraining()) return;
      needsResync.current = false;
      onResyncRef.current?.();
    };
    const offConnectivity = onConnectivityChange((online) => {
      if (!online) needsResync.current = true;
    });
    window.addEventListener(OUTBOX_DRAINED_EVENT, resync);

    // Create a uniquely named channel for this table and tenant.
    // Date.now() alone isn't unique enough: if multiple components mount
    // (and this effect fires) within the same millisecond -- now much more
    // likely since currentStaff/tenantId are available on the very first
    // render instead of arriving a few renders later -- two channels get
    // the identical name, Supabase's client returns the SAME already-
    // subscribed channel object for the second one, and calling .on() on
    // an already-subscribed channel throws ("cannot add postgres_changes
    // callbacks ... after subscribe()"), crashing the whole app. Confirmed
    // live on staging. crypto.randomUUID() removes the collision entirely.
    const channelName = `realtime:${table}:${tenantId}:${crypto.randomUUID()}`;

    // Tenant isolation is enforced by Postgres RLS itself -- Supabase
    // Realtime's postgres_changes only ever delivers rows the connected
    // client's RLS policies would let it SELECT (verified live: orders'
    // orders_tenant_read policy is `tenant_id = app_current_tenant_id()`),
    // so a client never receives another tenant's row over the socket in
    // the first place. The check below is a defense-in-depth guard against
    // a future RLS regression, not the actual isolation boundary -- do not
    // rely on it alone, and do not assume rows for other tenants are ever
    // silently filtered client-side by design.
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        const record = (payload.new || payload.old) as any;
        if (record && record.tenant_id && tenantId && record.tenant_id !== tenantId) {
          return;
        }

        if (table === 'orders' && payload) {
          const mutablePayload = { ...payload };
          if (mutablePayload.new) {
            mutablePayload.new = decodeOrderRow(mutablePayload.new);
          }
          if (mutablePayload.old) {
            mutablePayload.old = decodeOrderRow(mutablePayload.old);
          }
          onUpdateRef.current(mutablePayload);
        } else {
          onUpdateRef.current(payload);
        }
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Realtime Sync] Subscribed to ${table} for tenant ${tenantId}`);
          resync();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // P3.4: events missed from here on -- re-fetch once it is back.
          needsResync.current = true;
          if (status !== 'CLOSED') console.warn(`[Realtime Sync] ${table}: ${status}`, err);
        }
      });

    // Cleanup: always remove the channel to prevent memory leaks or duplicate listeners when component unmounts.
    return () => {
      offConnectivity();
      window.removeEventListener(OUTBOX_DRAINED_EVENT, resync);
      console.log(`[Realtime Sync] Unsubscribing from ${table} for tenant ${tenantId}`);
      supabase.removeChannel(channel);
    };
  }, [table, tenantId]);
}
