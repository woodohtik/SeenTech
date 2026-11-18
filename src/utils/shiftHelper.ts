import { supabase } from '../lib/supabase/client';

/**
 * seen-status-fix-regressions-task.md item 5: Orders.tsx/Customers.tsx's
 * payment call sites (record_order_payment) never passed p_shift_id, so
 * cash collected there never entered any till's reconciliation even after
 * close_shift started summing `payments` by shift_id (20261115050000) --
 * there was simply never a shift_id on the row to sum. Resolves the
 * caller's own currently open shift the same way Sales.tsx does for POS,
 * so these payments can be attributed to it. Returns null when the staff
 * member has no open shift (record_order_payment already treats
 * p_shift_id as optional -- the payment still gets a durable `payments`
 * row, it just isn't attributed to any till).
 */
export async function getOpenShiftId(tenantId: string, staffId: string | undefined): Promise<string | null> {
  if (!tenantId || !staffId) return null;
  const { data } = await supabase
    .from('shifts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('staff_id', staffId)
    .eq('status', 'open')
    .maybeSingle();
  return data?.id ?? null;
}
