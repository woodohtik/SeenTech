import { useEffect } from 'react';
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
  useEffect(() => {
    if (!tenantId) return;

    // Strict tenant isolation: Only listen for events where tenant_id matches the active tenant.
    const filter = `tenant_id=eq.${tenantId}`;
    
    // Create a uniquely named channel for this table and tenant
    const channelName = `realtime:${table}:${tenantId}`;
    
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter }, (payload) => {
        if (table === 'orders' && payload) {
          const mutablePayload = { ...payload };
          if (mutablePayload.new) {
            mutablePayload.new = decodeOrderRow(mutablePayload.new);
          }
          if (mutablePayload.old) {
            mutablePayload.old = decodeOrderRow(mutablePayload.old);
          }
          onUpdate(mutablePayload);
        } else {
          onUpdate(payload);
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
  }, [table, tenantId, onUpdate]);
}
