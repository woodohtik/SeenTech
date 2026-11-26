import React from 'react';
import { useDirection } from '../../lib/direction';
import { stylePrefsOf } from '../../utils/customerStylePrefs';

/**
 * The profile's "design preferences" (seen-merchant-trial-test-2026-11-26.md,
 * phase 2 item 3): read from the same place the order form fills from -- the
 * customer's saved style fields -- not the old `styles` (neck shape, sleeve),
 * which said "no pocket" while the chart above showed a visible one.
 * Collar, cuff, pocket, chest and shoulder are in the chart section above;
 * these are the rest.
 */
const ROWS: { key: 'cuttingType' | 'collarPadding' | 'closureType' | 'closureVisibility'; labelKey: string; options: Record<string, string> }[] = [
  { key: 'cuttingType', labelKey: 'measurements.cutting_type', options: { saudi: 'customers.cutting_saudi', kuwaiti: 'customers.cutting_kuwaiti', omani: 'customers.cutting_omani', emirati: 'customers.cutting_emirati' } },
  { key: 'collarPadding', labelKey: 'orders.padding_type', options: { hard: 'orders.padding_hard', soft: 'orders.padding_soft' } },
  { key: 'closureType', labelKey: 'measurements.closure_type', options: { buttons: 'inventory.button', zipper: 'measurements.zipper' } },
  { key: 'closureVisibility', labelKey: 'measurements.closure_visibility', options: { visible: 'inventory.status_visible', hidden: 'inventory.pocket_hidden' } },
];

export function CustomerStylePreferences({ measurements }: { measurements: Record<string, unknown> | null | undefined }) {
  const { t } = useDirection();
  const prefs = stylePrefsOf(measurements);
  return (
    <div className="grid grid-cols-1 main-640:grid-cols-2 main-900:grid-cols-4 gap-3 main-640:gap-4">
      {ROWS.map((row) => {
        const value = prefs[row.key];
        return (
          <div key={row.key} className="bg-surface-muted p-4 rounded-xl main-640:rounded-2xl border border-border">
            <span className="text-sm text-content-muted font-bold block mb-1">{t(row.labelKey)}</span>
            <span className="text-sm font-bold text-content">
              {value ? (row.options[value] ? t(row.options[value]) : value) : t('orders.not_specified')}
            </span>
          </div>
        );
      })}
    </div>
  );
}
