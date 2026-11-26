import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { toggleExtraCategory } from '../../utils/supplierCategories';

/**
 * "Also sells" on the supplier form (seen-merchant-trial-test-2026-11-26.md,
 * phase 3 item 4): more categories beside the main one.
 */
export function SupplierExtraCategories({ options, main, value, onChange }: {
  options: { value: string; label: string }[];
  main: string | null | undefined;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const others = options.filter((o) => o.value !== main);
  if (others.length === 0) return null;
  return (
    <fieldset className="space-y-2">
      <legend className="block text-sm font-medium text-content-muted mb-1">{t('procurement.extra_categories')}</legend>
      <div className="flex flex-wrap gap-2">
        {others.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(toggleExtraCategory(value, o.value, main))}
              className={cn(
                'min-h-11 px-3 rounded-xl border text-sm font-bold transition-colors',
                on ? 'bg-brand text-white border-brand' : 'bg-surface text-content border-border hover:border-brand'
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
