import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

/**
 * Under a purchase line's price, when it differs from the product's purchase
 * price (seen-product-variants-barcode-po-price-task.md, phase 4, question 4):
 * "the product's price is 12.00 -> the new one 13.00" and a box, ticked by
 * default, to update the product when the order is confirmed.
 */
export function PoLinePriceHint({ currentCost, newCost, perUnit, checked, onChange, aboveSellingPrice }: {
  currentCost: number;
  newCost: number;
  /** "a metre" or "a piece": what the product's price is per. */
  perUnit: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  aboveSellingPrice: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5 rounded-lg bg-surface-muted/60 p-2" data-testid="po-price-hint">
      <p className="text-sm text-content">
        {t('procurement.cost_change', { from: currentCost.toFixed(2), to: newCost.toFixed(2), unit: perUnit })}
      </p>
      <label className="flex items-center gap-2 min-h-11 text-sm font-bold text-content cursor-pointer">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-5 h-5 accent-brand" />
        {t('procurement.update_product_cost')}
      </label>
      {aboveSellingPrice && (
        <p className="flex items-center gap-1.5 text-sm font-bold text-warning">
          <AlertTriangle size={14} aria-hidden="true" />{t('procurement.cost_above_selling')}
        </p>
      )}
    </div>
  );
}
