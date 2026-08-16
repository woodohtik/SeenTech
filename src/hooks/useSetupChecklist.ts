import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { TOUR_CHECKLIST, type TourChecklistItem } from '../config/tourSteps';

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
      const [tenantRes, inventoryRes, customerRes, ordersRes, invoicesRes] = await Promise.all([
        supabase.from('tenants').select('address, phone, vat_number').eq('id', tenantId).maybeSingle(),
        supabase.from('inventory_items').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        supabase.from('customers').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        supabase.from('tax_invoices').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      ]);

      setCompletion({
        shop_profile: !!(tenantRes.data && (tenantRes.data.address || tenantRes.data.phone || tenantRes.data.vat_number)),
        add_stock: !!(inventoryRes.count && inventoryRes.count > 0),
        add_customer: !!(customerRes.count && customerRes.count > 0),
        first_order: !!(ordersRes.count && ordersRes.count > 0),
        first_sale: !!(invoicesRes.count && invoicesRes.count > 0),
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
