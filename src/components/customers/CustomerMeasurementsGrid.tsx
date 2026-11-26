import React from 'react';
import { Ruler } from 'lucide-react';
import { useDirection } from '../../lib/direction';
import { measurementRows } from '../../constants/measurementFields';
import { formatMeasurement, unitLabelKey, type MeasurementUnit } from '../../utils/measurementUnits';

/**
 * The profile's measurements (seen-merchant-trial-test-2026-11-26.md, phase 2
 * item 4): the filled ones as cards; the empty ones gathered on one line
 * ("not filled: ...") instead of a card each reading "- inch".
 */
export function splitMeasurements(measurements: unknown) {
  const all = measurementRows(measurements, true);
  return { filled: all.filter((r) => r.value > 0 || r.note), empty: all.filter((r) => !(r.value > 0) && !r.note) };
}

export function CustomerMeasurementsGrid({ measurements, unit }: { measurements: unknown; unit: MeasurementUnit }) {
  const { t } = useDirection();
  const { filled, empty } = splitMeasurements(measurements);
  return (
    <div className="space-y-3">
      {filled.length > 0 ? (
        <div className="grid grid-cols-2 main-720:grid-cols-4 gap-3 main-640:gap-4">
          {filled.map((row) => (
            <div key={row.key} className="bg-surface p-3 main-640:p-4 rounded-xl main-640:rounded-2xl border border-border hover:border-brand/20 transition-all shadow-sm min-w-0">
              <div className="flex items-center gap-1.5 main-640:gap-2 mb-1.5 main-640:mb-2 min-w-0">
                <div className="p-1.5 rounded-lg bg-brand/10 text-brand shrink-0"><Ruler size={14} aria-hidden="true" /></div>
                <p className="text-sm text-content-muted font-black leading-tight">{t(row.labelKey)}</p>
              </div>
              {row.value > 0 && (
                <p className="text-base main-640:text-xl font-black text-content">
                  <bdi dir="ltr" className="tabular-nums">{formatMeasurement(row.value, unit)}</bdi>
                  <span className="text-sm text-content-muted ms-1 font-bold">{t(unitLabelKey(unit))}</span>
                </p>
              )}
              {row.note && <p className="mt-1 text-sm text-content-muted break-words">{row.note}</p>}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm font-bold text-content-muted">{t('customers.no_measurements_yet')}</p>
      )}
      {empty.length > 0 && filled.length > 0 && (
        <p className="text-sm font-bold text-content-muted">
          {t('customers.measurements_not_filled')}: {empty.map((r) => t(r.labelKey)).join('، ')}
        </p>
      )}
    </div>
  );
}
