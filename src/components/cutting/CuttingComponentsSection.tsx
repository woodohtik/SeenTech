import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { CuttingComponent } from '../../utils/garmentComponents';

/**
 * The garment's components in the cutting dialog
 * (seen-merchant-trial-test-2026-11-26.md, phase 2 item 2): the shop's
 * defaults, editable for this order, plus "keep these as the default" so they
 * are set once. Taken from stock with the stage move, once per order.
 */
export interface CuttingComponentsValue {
  components: CuttingComponent[];
  saveAsDefault: boolean;
}

export function CuttingComponentsSection({
  value, onChange, options, garmentTypes, canSaveDefault,
}: {
  value: CuttingComponentsValue;
  onChange: (v: CuttingComponentsValue) => void;
  /** The shop's non-cloth stock items, to add one. */
  options: { id: string; name: string }[];
  garmentTypes: string[];
  canSaveDefault: boolean;
}) {
  const { t } = useTranslation();
  const used = new Set(value.components.map((c) => c.itemId));
  const addable = options.filter((o) => !used.has(o.id));
  const set = (components: CuttingComponent[]) => onChange({ ...value, components });

  return (
    <section aria-labelledby="cutting-components-title" className="space-y-2 pt-3 border-t border-border">
      <h4 id="cutting-components-title" className="text-sm font-black text-content">{t('orders.cutting_components_title')}</h4>
      {value.components.length === 0 && (
        <p className="text-sm font-bold text-content-muted">{t('orders.cutting_components_none')}</p>
      )}
      {value.components.map((c, index) => (
        <div key={c.itemId} className="flex items-center gap-2 rounded-2xl border border-border bg-surface-muted p-3">
          <p className="flex-1 min-w-0 text-sm font-black text-content truncate">{c.name}</p>
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            aria-label={t('orders.cutting_component_qty_label', { name: c.name })}
            value={Number.isFinite(c.quantity) ? String(c.quantity) : ''}
            onChange={(e) => {
              const q = Math.max(0, Number(e.target.value) || 0);
              set(value.components.map((x, i) => (i === index ? { ...x, quantity: q } : x)));
            }}
            className="w-20 min-h-11 bg-surface border border-border rounded-xl px-2 text-base font-black text-content text-center outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
          />
          <button
            type="button"
            onClick={() => set(value.components.filter((_, i) => i !== index))}
            aria-label={t('orders.cutting_component_remove', { name: c.name })}
            className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-xl text-content-muted hover:text-danger hover:bg-surface"
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      ))}
      {addable.length > 0 && (
        <label className="flex items-center gap-2">
          <Plus size={16} className="text-brand shrink-0" aria-hidden="true" />
          <span className="sr-only">{t('orders.cutting_component_add')}</span>
          <select
            value=""
            onChange={(e) => {
              const opt = addable.find((o) => o.id === e.target.value);
              if (opt) set([...value.components, { itemId: opt.id, name: opt.name, quantity: 1 }]);
            }}
            className="flex-1 min-h-11 bg-surface border border-border rounded-xl px-3 text-sm font-bold text-content"
          >
            <option value="">{t('orders.cutting_component_add')}</option>
            {addable.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      )}
      {canSaveDefault && garmentTypes.length === 1 && (
        <label className="flex items-center gap-2 min-h-11 text-sm font-bold text-content cursor-pointer">
          <input
            type="checkbox"
            checked={value.saveAsDefault}
            onChange={(e) => onChange({ ...value, saveAsDefault: e.target.checked })}
            className="h-5 w-5 accent-[var(--seen-brand,currentColor)]"
          />
          {t('orders.cutting_components_save_default', { garment: garmentTypes[0] })}
        </label>
      )}
    </section>
  );
}
