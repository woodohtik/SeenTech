import React from 'react';
import { useDirection } from '../../lib/direction';
import { cn } from '../../lib/utils';

/**
 * A tailor's commission on the add-employee form
 * (seen-merchant-trial-test-2026-11-26.md, phase 2 item 1, question 3's
 * default): a share of the order before VAT, or a fixed amount per order;
 * it falls due when the order reaches "ready"
 * (calculate_order_tailor_commission). The owner can still change it later
 * under Staff > tailor commissions.
 */
export type CommissionType = 'percentage' | 'fixed_amount';

export interface StaffCommissionValue { type: CommissionType; value: string }

export function StaffCommissionFields({ value, onChange }: { value: StaffCommissionValue; onChange: (v: StaffCommissionValue) => void }) {
  const { t } = useDirection();
  const options: { key: CommissionType; label: string }[] = [
    { key: 'percentage', label: t('staff.commission_percentage') },
    { key: 'fixed_amount', label: t('staff.commission_fixed') },
  ];
  return (
    <fieldset className="p-4 bg-surface-muted rounded-2xl space-y-3">
      <legend className="text-sm font-black text-content px-1">{t('staff.commission_title')}</legend>
      <div className="flex gap-2" role="radiogroup" aria-label={t('staff.commission_title')}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={value.type === o.key}
            onClick={() => onChange({ ...value, type: o.key })}
            className={cn(
              'flex-1 min-h-11 rounded-xl border text-sm font-bold transition-colors',
              value.type === o.key ? 'bg-brand text-white border-brand' : 'bg-surface text-content border-border hover:border-brand'
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <label className="block space-y-1.5">
        <span className="block text-sm font-bold text-content-muted px-1">
          {value.type === 'percentage' ? t('staff.commission_value_percentage') : t('staff.commission_value_fixed')}
        </span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={value.type === 'percentage' ? 100 : undefined}
          step="0.01"
          dir="ltr"
          value={value.value}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
          className="w-full min-h-11 rounded-xl border border-border bg-surface px-3 text-content font-bold focus:outline-none focus:ring-2 focus:ring-brand"
          placeholder="0"
        />
      </label>
      <p className="text-sm text-content-muted px-1">{t('staff.commission_hint')}</p>
    </fieldset>
  );
}
