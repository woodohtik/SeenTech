import { useEffect } from 'react';
import { supabase } from '../lib/supabase/client';

/** How often permissions are re-read while the app is visible (the deactivation bound). */
export const PERMISSIONS_REFRESH_MS = 60_000;

/**
 * seen-permissions-fix-task.md Phase 6: a change to permissions reaches every
 * open device, not just the browser that made it.
 *
 * Mounted once for the shop: a Realtime subscription on the shop's roles and
 * user_permission_overrides rows, and a re-read every 60 seconds while the
 * page is visible. Both announce `permissions_updated`, which every
 * usePermissions() already listens for (getEffectivePermissions de-duplicates
 * the burst into one server call).
 *
 * The 60-second re-read is also the bound for a deactivated employee: their
 * PIN sessions are revoked by the database at once
 * (staff_deactivation_ends_sessions), and the next re-read tells the device
 * (get_my_permissions -> session_invalid), which returns to the PIN screen.
 * The staff table is not on Realtime on purpose: it carries pin_hash.
 */
export function usePermissionsLiveRefresh(tenantId: string | null | undefined): void {
  useEffect(() => {
    if (!tenantId || typeof window === 'undefined') return;
    const announce = () => window.dispatchEvent(new CustomEvent('permissions_updated', { detail: { tenantId } }));

    const channel = supabase
      .channel(`permissions:${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roles', filter: `tenant_id=eq.${tenantId}` }, announce)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_permission_overrides', filter: `tenant_id=eq.${tenantId}` }, announce)
      .subscribe();

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') announce();
    }, PERMISSIONS_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') announce(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, [tenantId]);
}
