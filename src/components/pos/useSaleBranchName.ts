import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase/client';

/**
 * The name of the branch a POS sale belongs to -- the open shift's branch
 * (create_pos_sale takes branch_id from the shift), else the employee's own
 * (seen-merchant-trial-test-2026-11-26.md: the receipt said "الفرع الرئيسي"
 * for every shop).
 */
export function useSaleBranchName(tenantId: string, shiftId?: string | null, fallbackBranchId?: string | null): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let branchId = fallbackBranchId || null;
        if (shiftId) {
          const { data } = await supabase.from('shifts').select('branch_id').eq('tenant_id', tenantId).eq('id', shiftId).maybeSingle();
          branchId = (data as { branch_id?: string } | null)?.branch_id || branchId;
        }
        if (!branchId) { if (!cancelled) setName(null); return; }
        const { data: branch } = await supabase.from('branches').select('name').eq('tenant_id', tenantId).eq('id', branchId).maybeSingle();
        if (!cancelled) setName((branch as { name?: string } | null)?.name || null);
      } catch {
        // Offline: the receipt simply leaves the branch out.
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, shiftId, fallbackBranchId]);
  return name;
}
