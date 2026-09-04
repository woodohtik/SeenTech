import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase/client';
import { decodeOrderRow } from '../utils/orderHistoryHelper';

/**
 * A custom hook to synchronize Supabase tables in real-time.
 * 
 * @param table The name of the table to listen to (e.g., 'orders', 'inventory_items').
 * @param tenantId The current user's tenant ID, used to isolate data strictly to their tenant.
 * @param onUpdate The callback function that runs when an INSERT, UPDATE, or DELETE payload arrives.
 */
export function useRealtimeSync(table: string, tenantId: string | undefined, onUpdate: (payload: any) => void) {
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  });

  useEffect(() => {
    if (!tenantId) return;

    // Create a uniquely named channel for this table and tenant
    const channelName = `realtime:${table}:${tenantId}:${Date.now()}`;

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
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Realtime Sync] Subscribed to ${table} for tenant ${tenantId}`);
        }
      });

    // Cleanup: always remove the channel to prevent memory leaks or duplicate listeners when component unmounts.
    return () => {
      console.log(`[Realtime Sync] Unsubscribing from ${table} for tenant ${tenantId}`);
      supabase.removeChannel(channel);
    };
  }, [table, tenantId]);
}
