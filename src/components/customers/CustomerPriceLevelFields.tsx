import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

/**
 * A fabric store's customer (seen-open-verticals-task.md, wave 1, item 4):
 * «تجزئة» or «جملة» (a tailor buying for his shop pays the wholesale price --
 * create_pos_sale decides it), and a credit limit the POS warns past.
 */
export function CustomerPriceLevelFields({ priceLevel, creditLimit, onChange }: {
  priceLevel: 'retail' | 'wholesale';
  creditLimit: number | '' | null | undefined;
  onChange: (next: { priceLevel?: 'retail' | 'wholesale'; creditLimit?: number | '' }) => void;
}) {
  const { t } = useTranslation();
  const option = (value: 'retail' | 'wholesale', label: string) => (
    <button type="button" role="radio" aria-checked={priceLevel === value} onClick={() => onChange({ priceLevel: value })}
      className={cn('min-h-11 flex-1 px-4 rounded-xl border text-sm font-bold',
        priceLevel === value ? 'bg-brand text-white border-brand' : 'bg-surface text-content border-border hover:border-brand')}>
      {label}
    </button>
  );
  return (
    <div className="grid grid-cols-1 main-640:grid-cols-2 gap-4" data-testid="customer-price-level">
      <div className="space-y-2">
        <span id="customer-price-level-label" className="block text-sm font-bold text-content-muted">{t('customers.price_level')}</span>
        <div className="flex gap-2" role="radiogroup" aria-labelledby="customer-price-level-label">
          {option('retail', t('customers.price_level_retail'))}
          {option('wholesale', t('customers.price_level_wholesale'))}
        </div>
      </div>
      <div className="space-y-2">
        <label htmlFor="customer-credit-limit" className="block text-sm font-bold text-content-muted">{t('customers.credit_limit')}</label>
        <input
          id="customer-credit-limit"
          type="number"
          min="0"
          step="1"
          inputMode="decimal"
          dir="ltr"
          value={creditLimit ?? ''}
          placeholder={t('customers.credit_limit_hint')}
          onChange={(e) => onChange({ creditLimit: e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0) })}
          className="w-full h-12 px-4 bg-surface border border-border rounded-xl outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand font-semibold text-content tabular-nums"
        />
      </div>
    </div>
  );
}
