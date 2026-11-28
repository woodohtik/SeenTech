import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Measurements } from '../../types';
import {
  FIELD_NOTE_MAX, WOMENS_MEASUREMENT_FIELDS, measurementLabelKey, womensFieldsInColumn, type WomensMeasurementKey,
} from '../../constants/measurementFields';
import { cmToDisplayUnit, displayUnitToCm, parseMeasurementInput, unitLabelKey, type MeasurementUnit } from '../../utils/measurementUnits';

/**
 * Women's tailoring measurements (seen-open-verticals-task.md, wave 1,
 * question 2's default) -- the same props and habits as the thobe selector
 * (ThobeMeasurementSelector, which men's tailoring keeps, untouched):
 * numbered fields in two columns, ten basic and six behind «مقاسات متقدمة»,
 * a note per field (staff only), Enter to the next / Shift+Enter back,
 * centimetres or inches, and a dress drawing whose numbers light up with the
 * field in use. Values are stored in cm on the customer's same measurements.
 */
export interface WomensMeasurementSelectorProps {
  values: Measurements;
  onChange: (values: Measurements) => void;
  readOnly?: boolean;
  measurementUnit: MeasurementUnit;
  showAdvanced?: boolean;
  onShowAdvancedChange?: (show: boolean) => void;
  rememberAdvanced?: boolean;
  showNotes?: boolean;
}

const SHOW_ADVANCED_KEY = 'seen.measurements.womens.showAdvanced';
const ADVANCED_KEYS = WOMENS_MEASUREMENT_FIELDS.filter((f) => f.tier === 'advanced').map((f) => f.key);
const ORDER = WOMENS_MEASUREMENT_FIELDS.slice().sort((a, b) => a.slot - b.slot).map((f) => f.key);
const FIELD_OF = Object.fromEntries(WOMENS_MEASUREMENT_FIELDS.map((f) => [f.key, f])) as Record<WomensMeasurementKey, (typeof WOMENS_MEASUREMENT_FIELDS)[number]>;

const valueOf = (values: Measurements, key: WomensMeasurementKey) => {
  const n = Number((values as Record<string, unknown>)[key]);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function WomensMeasurementSelector({
  values, onChange, readOnly = false, measurementUnit, showAdvanced, onShowAdvancedChange, rememberAdvanced = true, showNotes = false,
}: WomensMeasurementSelectorProps) {
  const { t } = useTranslation();
  const label = (key: WomensMeasurementKey) => t(measurementLabelKey(key, 'womens'));
  const hasAdvancedValue = ADVANCED_KEYS.some((k) => valueOf(values, k) > 0 || !!values.fieldNotes?.[k]);
  const [ownAdvanced, setOwnAdvanced] = useState<boolean>(() => {
    if (hasAdvancedValue) return true;
    if (!rememberAdvanced) return false;
    try { return localStorage.getItem(SHOW_ADVANCED_KEY) === '1'; } catch { return false; }
  });
  const advancedOpen = showAdvanced ?? ownAdvanced;
  const setAdvanced = (open: boolean) => {
    if (onShowAdvancedChange) onShowAdvancedChange(open); else setOwnAdvanced(open);
    if (rememberAdvanced) { try { localStorage.setItem(SHOW_ADVANCED_KEY, open ? '1' : '0'); } catch { /* no storage */ } }
  };

  const [active, setActive] = useState<WomensMeasurementKey | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<WomensMeasurementKey, string>>>({});
  const inputs = useRef<Partial<Record<WomensMeasurementKey, HTMLInputElement | null>>>({});
  const [focusNext, setFocusNext] = useState<WomensMeasurementKey | null>(null);
  useEffect(() => {
    if (focusNext && inputs.current[focusNext]) { inputs.current[focusNext]!.focus(); setFocusNext(null); }
  }, [focusNext, advancedOpen]);

  const shown = useMemo(() => ORDER.filter((k) => advancedOpen || !ADVANCED_KEYS.includes(k)), [advancedOpen]);
  const unit = t(unitLabelKey(measurementUnit));

  const display = (key: WomensMeasurementKey) => {
    if (drafts[key] !== undefined) return drafts[key]!;
    const cm = valueOf(values, key);
    return cm > 0 ? String(cmToDisplayUnit(cm, measurementUnit)) : '';
  };

  const commit = (key: WomensMeasurementKey) => {
    const text = drafts[key];
    if (text === undefined) return;
    const parsed = parseMeasurementInput(text);
    setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
    if (parsed === null) return; // not a measurement: keep the stored value
    const cm = parsed > 0 ? Math.min(displayUnitToCm(parsed, measurementUnit), FIELD_OF[key].maxCm) : 0;
    const next: Record<string, unknown> = { ...values };
    if (cm > 0) next[key] = cm; else delete next[key];
    onChange(next as Measurements);
  };

  const move = (key: WomensMeasurementKey, step: 1 | -1) => {
    const i = shown.indexOf(key);
    const target = shown[i + step];
    if (target) { setActive(target); setFocusNext(target); }
    else if (step === 1 && !advancedOpen && ADVANCED_KEYS.length) { setAdvanced(true); setActive(ADVANCED_KEYS[0]); setFocusNext(ADVANCED_KEYS[0]); }
  };

  const setNote = (key: WomensMeasurementKey, note: string) => {
    const notes = { ...(values.fieldNotes || {}) } as Record<string, string>;
    const text = note.slice(0, FIELD_NOTE_MAX);
    if (text) notes[key] = text; else delete notes[key];
    onChange({ ...values, fieldNotes: Object.keys(notes).length ? notes : undefined });
  };

  const fieldCard = (key: WomensMeasurementKey) => {
    const f = FIELD_OF[key];
    const id = `womens-field-${key}`;
    return (
      <div key={key}
        className={cn('flex flex-col gap-2 rounded-[8px] border bg-surface p-3 transition-colors', active === key ? 'border-brand' : 'border-border')}>
        <div className="flex min-w-0 items-start gap-2">
          <span aria-hidden="true" className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full font-heading text-sm font-bold tabular-nums',
            active === key ? 'bg-brand text-white' : 'bg-[#EBEDEF] text-content')}>{f.slot}</span>
          <label htmlFor={id} className="min-w-0 flex-1 break-words text-base font-medium leading-6 text-content">{label(key)}</label>
        </div>
        <div className="flex items-center gap-2">
          <input
            id={id}
            ref={(el) => { inputs.current[key] = el; }}
            type="text"
            inputMode="decimal"
            dir="ltr"
            autoComplete="off"
            readOnly={readOnly}
            value={display(key)}
            onFocus={() => setActive(key)}
            onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
            onBlur={() => commit(key)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
              e.preventDefault();
              commit(key);
              move(key, e.shiftKey ? -1 : 1);
            }}
            className="h-12 min-w-0 flex-1 rounded-[8px] border border-border bg-surface px-3 text-lg font-bold text-content tabular-nums outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <span className="shrink-0 text-sm font-medium text-content-muted">{unit}</span>
        </div>
        {showNotes && !readOnly && (
          <input
            type="text"
            aria-label={t('measurements.field_note_label', { name: label(key) })}
            placeholder={t('measurements.field_note_placeholder')}
            maxLength={FIELD_NOTE_MAX}
            value={(values.fieldNotes?.[key] as string) || ''}
            onChange={(e) => setNote(key, e.target.value)}
            className="h-11 rounded-[8px] border border-border bg-surface-muted/50 px-3 text-sm text-content outline-none focus:border-brand"
          />
        )}
        {readOnly && values.fieldNotes?.[key] && <p className="text-sm text-content-muted">{values.fieldNotes[key]}</p>}
      </div>
    );
  };

  const column = (side: 'start' | 'end') => (
    <div className="flex flex-col gap-3">
      {womensFieldsInColumn(side, 'basic').map(fieldCard)}
      {advancedOpen && womensFieldsInColumn(side, 'advanced').map(fieldCard)}
    </div>
  );

  return (
    <div className="@container space-y-4" data-measurement-set="womens">
      <div className="grid grid-cols-1 gap-4 @[760px]:grid-cols-[1fr_220px_1fr]">
        <div className="order-2 @[760px]:order-1">{column('start')}</div>
        <figure className="order-1 @[760px]:order-2 m-0 mx-auto w-full max-w-[220px]" aria-label={t('measurements.womens_figure')}>
          <DressFigure active={active} shown={shown} />
        </figure>
        <div className="order-3">{column('end')}</div>
      </div>
      <button
        type="button"
        aria-expanded={advancedOpen}
        onClick={() => setAdvanced(!advancedOpen)}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[8px] border border-[var(--seen-neutral-500)] bg-surface px-4 text-base font-semibold text-content hover:bg-surface-muted @[760px]:w-auto"
      >
        {advancedOpen ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
        {advancedOpen ? t('measurements.womens_hide_advanced') : t('measurements.womens_advanced')}
        {!advancedOpen && <span className="rounded-full bg-surface-muted px-2 text-sm tabular-nums">{ADVANCED_KEYS.length}</span>}
      </button>
    </div>
  );
}

/** A simple dress, the same line style as the thobe's drawing; each field's number on it. */
function DressFigure({ active, shown }: { active: WomensMeasurementKey | null; shown: WomensMeasurementKey[] }) {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-auto text-content-muted" aria-hidden="true">
      <path
        d="M42,4 Q50,9 58,4 L70,10 L86,44 L80,47 L68,24 L66,40 Q64,46 68,52 L82,98 L18,98 L32,52 Q36,46 34,40 L32,24 L20,47 L14,44 L30,10 Z"
        fill="var(--surface-muted, #f1f3f5)" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round"
      />
      <path d="M34,40 Q50,44 66,40" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="1.5,1.5" />
      {shown.map((key) => {
        const f = WOMENS_MEASUREMENT_FIELDS.find((x) => x.key === key)!;
        const on = active === key;
        return (
          <g key={key}>
            <circle cx={f.at.x} cy={f.at.y} r={on ? 4.2 : 3.4} fill={on ? 'var(--brand, #1F6FEB)' : '#fff'} stroke={on ? 'none' : 'currentColor'} strokeWidth="0.5" />
            <text x={f.at.x} y={f.at.y + 1.3} textAnchor="middle" fontSize="3.6" fontWeight="700" fill={on ? '#fff' : '#1b1f24'}>{f.slot}</text>
          </g>
        );
      })}
    </svg>
  );
}
