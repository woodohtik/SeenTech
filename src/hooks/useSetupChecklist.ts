import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { readTenantRow } from '../lib/tenantRow';
import { TOUR_CHECKLIST, type TourChecklistItem } from '../config/tourSteps';
import { useRealtimeSync } from './useRealtimeSync';

type SetupProgress = { has_stock: boolean; has_customers: boolean; has_orders: boolean; has_invoices: boolean };

function isMissingFunction(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

/**
 * Whether the shop has any stock items, customers, orders and tax invoices:
 * one request (get_setup_progress, EXISTS under the caller's RLS --
 * seen-performance-first-open-login-task.md Phase 4.6) instead of four exact
 * counts. Where the function is not deployed yet, the four counts as before.
 */
export async function readSetupProgress(tenantId: string): Promise<SetupProgress> {
  const { data, error } = await supabase.rpc('get_setup_progress' as any, { p_tenant_id: tenantId });
  if (!error && data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    return {
      has_stock: d.has_stock === true,
      has_customers: d.has_customers === true,
      has_orders: d.has_orders === true,
      has_invoices: d.has_invoices === true,
    };
  }
  if (error && !isMissingFunction(error)) throw error;
  const [inventoryRes, customerRes, ordersRes, invoicesRes] = await Promise.all([
    supabase.from('inventory_items').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase.from('tax_invoices').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
  ]);
  return {
    has_stock: !!(inventoryRes.count && inventoryRes.count > 0),
    has_customers: !!(customerRes.count && customerRes.count > 0),
    has_orders: !!(ordersRes.count && ordersRes.count > 0),
    has_invoices: !!(invoicesRes.count && invoicesRes.count > 0),
  };
}

interface CompletionState {
  shop_profile: boolean;
  add_stock: boolean;
  add_customer: boolean;
  first_order: boolean;
  first_sale: boolean;
}

const EMPTY_COMPLETION: CompletionState = {
  shop_profile: false,
  add_stock: false,
  add_customer: false,
  first_order: false,
  first_sale: false,
};

/**
 * Shared source of truth for the post-onboarding "quick start" checklist —
 * consumed by both TourFinishModal (shown once, right after the tour) and
 * SetupChecklistBar (the persistent reminder shown on every page until the
 * checklist is fully done), so the two never drift out of sync.
 *
 * `items` should already be permission-filtered by the caller (same list the
 * tour itself was built from) — this hook only adds the live completion data.
 */
export function useSetupChecklist(tenantId?: string | null, items: TourChecklistItem[] = TOUR_CHECKLIST) {
  const [completion, setCompletion] = useState<CompletionState>(EMPTY_COMPLETION);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [tenantRes, progress] = await Promise.all([
        readTenantRow(tenantId), // shared read (lib/tenantRow)
        readSetupProgress(tenantId),
      ]);

      setCompletion({
        shop_profile: !!(tenantRes.data && (tenantRes.data.address || tenantRes.data.phone || tenantRes.data.vat_number)),
        add_stock: progress.has_stock,
        add_customer: progress.has_customers,
        first_order: progress.has_orders,
        first_sale: progress.has_invoices,
      });
    } catch (err) {
      console.error('Error fetching setup checklist completion:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live-refresh whenever any of the tables the checklist depends on change,
  // so completing a step elsewhere in the app (adding a product, a customer,
  // a sale…) is reflected here without needing a page reload.
  const realtimeTenantId = tenantId ?? undefined;
  useRealtimeSync('tenants', realtimeTenantId, refresh);
  useRealtimeSync('inventory_items', realtimeTenantId, refresh);
  useRealtimeSync('customers', realtimeTenantId, refresh);
  useRealtimeSync('orders', realtimeTenantId, refresh);
  useRealtimeSync('tax_invoices', realtimeTenantId, refresh);

  const checklist = items;

  // Progressive unlock: an item only counts as "visible/next" once the item
  // before it in the sequence is done — mirrors the guided order of the tour.
  const visibleItems = useMemo(() => {
    const items: (TourChecklistItem & { completed: boolean })[] = [];
    for (let i = 0; i < checklist.length; i++) {
      const item = checklist[i];
      const isCompleted = completion[item.id as keyof CompletionState] || false;
      if (i === 0) {
        items.push({ ...item, completed: isCompleted });
      } else {
        const prevItem = checklist[i - 1];
        const isPrevCompleted = completion[prevItem.id as keyof CompletionState] || false;
        if (isPrevCompleted) {
          items.push({ ...item, completed: isCompleted });
        } else {
          break;
        }
      }
    }
    return items;
  }, [checklist, completion]);

  const activeItem = useMemo(() => {
    const last = visibleItems[visibleItems.length - 1];
    return last && !last.completed ? last : null;
  }, [visibleItems]);

  const completedCount = useMemo(() => Object.values(completion).filter(Boolean).length, [completion]);
  const totalCount = checklist.length;
  const isComplete = totalCount > 0 && completedCount >= totalCount;

  return {
    completion,
    checklist,
    visibleItems,
    activeItem,
    completedCount,
    totalCount,
    isComplete,
    loading,
    refresh,
  };
}
