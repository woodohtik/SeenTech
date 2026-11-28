import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import { useDirection } from '../../lib/direction';
import type { Branch, Role } from '../../types';
import AddEmployeeModal from '../AddEmployeeModal';

/**
 * "+ إضافة خياط" beside the order's tailor picker
 * (seen-merchant-trial-test-2026-11-26.md, phase 2 item 1): the picker only
 * offered "unassigned" and there was no way to add one without leaving the
 * order. Opens the same add-employee form, set to tailor.
 */
export function QuickAddTailor({ tenantId, onAdded, currentStaffEmail }: { tenantId: string; onAdded: () => void; currentStaffEmail?: string }) {
  const { t } = useDirection();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    if (!open || branches.length) return;
    supabase.from('branches').select('id, name, is_main').eq('tenant_id', tenantId).then(({ data }) => {
      setBranches(((data || []) as any[]).map((b) => ({ ...b, id: b.id, name: b.name })) as Branch[]);
    });
  }, [open, tenantId, branches.length]);

  const roles = [{ id: 'tailor', roleKey: 'tailor', name: t('common.roles.tailor'), tenantId: null, description: '', permissions: {}, isDefault: true, createdAt: '' }] as unknown as Role[];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative inline-flex items-center gap-1 h-6 px-1 text-sm font-bold text-brand hover:underline after:absolute after:-inset-[10px] after:content-['']"
      >
        <Plus size={16} aria-hidden="true" />
        {t('orders.add_tailor')}
      </button>
      <AddEmployeeModal
        isOpen={open}
        onClose={() => setOpen(false)}
        tenantId={tenantId}
        roles={roles}
        branches={branches}
        presetRole="tailor"
        currentStaffEmail={currentStaffEmail}
        onSuccess={() => { setOpen(false); onAdded(); }}
      />
    </>
  );
}
