import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { allocateOpening } from '../../utils/variantOpening';

export type OpeningMode = 'same' | 'split';

export interface VariantOpeningState {
  mode: OpeningMode;
  /** row key -> the number set by hand for that variant. */
  pinned: Record<string, number>;
}

/** Each variant's opening quantity, in the entry unit, in row order. */
export function variantOpeningQuantities(
  rows: { key: string }[], total: number, wholeUnits: boolean, state: VariantOpeningState,
): number[] {
  const pinned: Record<number, number> = {};
  rows.forEach((r, i) => { if (state.pinned[r.key] !== undefined) pinned[i] = state.pinned[r.key]; });
  return allocateOpening({ total, count: rows.length, mode: state.mode, wholeUnits, pinned });
}

/**
 * The opening balance of a product with variants
 * (seen-product-variants-barcode-po-price-task.md, phase 3): the same number
 * for each variant, or shared among them; a live table, each cell editable
 * (a cell typed by hand stays; in "share" the others take what is left).
 */
export function VariantOpeningBalance({ rows, total, wholeUnits, unitLabel, value, onChange }: {
  rows: { key: string; name: string }[];
  total: number;
  wholeUnits: boolean;
  unitLabel: string;
  value: VariantOpeningState;
  onChange: (next: VariantOpeningState) => void;
}) {
  const { t } = useTranslation();
  if (rows.length === 0 || !(total > 0)) return null;
  const quantities = variantOpeningQuantities(rows, total, wholeUnits, value);
  const sum = Math.round(quantities.reduce((a, b) => a + b, 0) * 100) / 100;

  const choice = (mode: OpeningMode, label: string) => (
    <button type="button" aria-pressed={value.mode === mode} onClick={() => onChange({ mode, pinned: {} })}
      className={cn('min-h-11 flex-1 px-3 rounded-xl border text-sm font-bold',
        value.mode === mode ? 'bg-brand text-white border-brand' : 'bg-surface text-content border-border hover:border-brand')}>
      {label}
    </button>
  );

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-muted/50 p-3" data-testid="variant-opening">
      <div className="flex gap-2">
        {choice('same', t('inventory.variant_opening.same'))}
        {choice('split', t('inventory.variant_opening.split'))}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-content-muted">
            <th className="text-start font-bold py-1">{t('inventory.variant_opening.variant')}</th>
            <th className="text-start font-bold py-1">{t('inventory.variant_opening.quantity', { unit: unitLabel })}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className="border-t border-border">
              <td className="py-1.5 font-semibold text-content">{r.name}</td>
              <td className="py-1.5">
                <input type="number" min="0" step={wholeUnits ? '1' : '0.01'} inputMode="decimal"
                  aria-label={t('inventory.variant_opening.quantity_for', { name: r.name })}
                  value={quantities[i]}
                  onChange={(e) => {
                    const n = e.target.value === '' ? 0 : Math.max(0, Number(e.target.value) || 0);
                    onChange({ ...value, pinned: { ...value.pinned, [r.key]: wholeUnits ? Math.floor(n) : n } });
                  }}
                  className="w-28 px-2.5 py-2 bg-surface border border-border rounded-lg font-semibold text-content outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" />
                {value.pinned[r.key] !== undefined && (
                  <span className="ms-2 text-sm text-content-muted">{t('inventory.variant_opening.set_by_hand')}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border">
            <td className="py-1.5 font-black text-content">{t('inventory.variant_opening.total')}</td>
            <td className="py-1.5 font-black text-content">{sum} {unitLabel}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
