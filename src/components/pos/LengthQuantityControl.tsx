/**
 * The quantity of a POS cart line sold by length (seen-verticals-readiness-task.md
 * Phase 5): ± a quarter metre, a decimal field (the number pad on a touch
 * screen), and the unit it is typed in -- metres, yards or whole rolls. The
 * line itself always holds metres (utils/lengthSale).
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fromMeters, type LengthUnit } from '../../utils/lengthSale';

export default function LengthQuantityControl({
  meters, unit, metersPerRoll, onStep, onCommit,
}: {
  meters: number;
  unit: LengthUnit;
  metersPerRoll: number;
  onStep: (direction: 1 | -1) => void;
  onCommit: (value: number, unit: LengthUnit) => void;
}) {
  const { t } = useTranslation();
  const shown = fromMeters(meters, unit, metersPerRoll);
  const [draft, setDraft] = useState(String(shown));
  useEffect(() => { setDraft(String(shown)); }, [shown]);

  const commit = (nextUnit: LengthUnit = unit, raw: string = draft) => {
    const value = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      setDraft(String(shown));
      onCommit(0, nextUnit); // reported as invalid by the caller
      return;
    }
    onCommit(value, nextUnit);
  };

  const units: { value: LengthUnit; label: string }[] = [
    { value: 'meter', label: t('pos.unit_meter_short', 'م') },
    { value: 'yard', label: t('pos.unit_yard_short', 'ياردة') },
    ...(metersPerRoll > 0 ? [{ value: 'roll' as LengthUnit, label: t('pos.unit_roll', 'طاقة') }] : []),
  ];

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1 bg-surface-muted border border-border rounded-lg p-1">
        <button type="button" onClick={() => onStep(-1)} aria-label={t('pos.decrease_quantity')} className="w-11 h-11 flex items-center justify-center hover:bg-surface rounded transition-colors">-</button>
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          aria-label={t('pos.length_quantity', 'الكمية')}
          className="w-14 text-center font-bold text-content bg-transparent outline-none"
          dir="ltr"
        />
        <button type="button" onClick={() => onStep(1)} aria-label={t('pos.increase_quantity')} className="w-11 h-11 flex items-center justify-center hover:bg-surface rounded transition-colors">+</button>
      </div>
      <select
        value={unit}
        onChange={(e) => {
          const next = e.target.value as LengthUnit;
          // A whole roll is one roll; otherwise keep the same length in the new unit.
          commit(next, next === 'roll' ? '1' : String(fromMeters(meters, next, metersPerRoll)));
        }}
        aria-label={t('pos.length_unit', 'الوحدة')}
        className="h-11 rounded-lg border border-border bg-surface px-2 text-xs font-bold text-content"
      >
        {units.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
      </select>
    </div>
  );
}
