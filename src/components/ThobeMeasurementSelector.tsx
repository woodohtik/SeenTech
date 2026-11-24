import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Lightbulb, Mic } from 'lucide-react';
import { cn } from '../lib/utils';
import { Measurements } from '../types';
import Branding from './Branding';
import VoiceMeasurementWizard from './VoiceMeasurementWizard';
import { isSpeechRecognitionSupported } from '../hooks/useSpeechRecognition';
import { MeasurementUnit, cmToDisplayUnit, displayUnitToCm, formatMeasurement, parseMeasurementInput, roundToQuarter, spokenMeasurement, unitLabelKey } from '../utils/measurementUnits';
import { FractionPicker } from './ui/FractionPicker';
import { useDirection } from '../lib/direction';
import {
  ADVANCED_MEASUREMENT_KEYS,
  MEASUREMENT_FIELDS,
  countAdvancedValues,
  fieldsDownTheFigure,
  measurementHintKey,
  measurementLabelKey,
  type MeasurementKey,
  type MeasurementZone,
} from '../constants/measurementFields';
import { estimateFabricMeters, fabricInputFromMeasurements, metersToYards, type FabricEstimateSettings } from '../utils/fabricEstimate';

interface ThobeMeasurementSelectorProps {
  values: Measurements;
  onChange: (values: Measurements) => void;
  readOnly?: boolean;
  measurementUnit: MeasurementUnit;
  /**
   * Staff screens only: shows how much fabric the thobe takes under the
   * figure, recomputed on every change. Leave it out on the customer form.
   */
  fabricEstimate?: { settings: FabricEstimateSettings; fabricWidthCm?: number | null };
  /**
   * Whether the seven advanced measurements are on screen
   * (seen-measurements-basic-advanced-task.md). Leave both out and the
   * selector decides by itself: open when any advanced value is stored, or
   * when this device last left it open.
   */
  showAdvanced?: boolean;
  onShowAdvancedChange?: (show: boolean) => void;
  /** Remember the open/closed choice on this device. Off on the customer's own link. */
  rememberAdvanced?: boolean;
}

/** This device's last choice for the advanced section. */
export const SHOW_ADVANCED_KEY = 'seen.measurements.showAdvanced';
function readShowAdvanced(): boolean {
  try { return localStorage.getItem(SHOW_ADVANCED_KEY) === '1'; } catch { return false; }
}
function writeShowAdvanced(show: boolean) {
  try { localStorage.setItem(SHOW_ADVANCED_KEY, show ? '1' : '0'); } catch { /* no storage: the choice lasts for this visit */ }
}

type ThobePart = MeasurementKey;

// Each side's fields, top of the thobe first (task file question 5): the body
// on the right, the sleeve and cuff on the left. DOM order is the body side
// down, then the sleeve side down, so Tab follows what the eye sees.
const FIELD_OF = Object.fromEntries(MEASUREMENT_FIELDS.map((f) => [f.key, f])) as Record<ThobePart, (typeof MEASUREMENT_FIELDS)[number]>;
const DOM_ORDER: ThobePart[] = [...fieldsDownTheFigure('right', true), ...fieldsDownTheFigure('left', true)];
const FIRST_ADVANCED = DOM_ORDER.find((key) => FIELD_OF[key].tier === 'advanced')!;

// Each shown field's row in its column, counting only the fields on screen,
// so a column closes up when the advanced ones are hidden.
function fieldRows(showAdvanced: boolean) {
  const right = fieldsDownTheFigure('right', showAdvanced);
  const left = fieldsDownTheFigure('left', showAdvanced);
  const row: Record<string, number> = {};
  right.forEach((key, i) => { row[key] = i + 1; });
  left.forEach((key, i) => { row[key] = i + 1; });
  return { row, rows: Math.max(right.length, left.length) };
}
const ADVANCED = new Set<string>(ADVANCED_MEASUREMENT_KEYS);
const ZONE_OF = Object.fromEntries(MEASUREMENT_FIELDS.map((f) => [f.key, f.zone])) as Record<ThobePart, MeasurementZone>;
const ZONE_KEYS = MEASUREMENT_FIELDS.reduce((acc, f) => {
  (acc[f.zone] ||= []).push(f.key);
  return acc;
}, {} as Record<MeasurementZone, ThobePart[]>);

// Where a zone's value label sits on the 400x800 drawing.
const ZONE_LABEL_AT: Record<MeasurementZone, { x: number; y: number }> = {
  neck: { x: 200, y: 90 },
  shoulder: { x: 200, y: 145 },
  chest: { x: 200, y: 250 },
  waist: { x: 200, y: 380 },
  sleeve: { x: 63, y: 300 },
  sleeveTop: { x: 62, y: 240 },
  midSleeve: { x: 55, y: 356 },
  wrist: { x: 35, y: 520 },
  cuff: { x: 35, y: 440 },
  cuffWidth: { x: 365, y: 520 },
  length: { x: 240, y: 560 },
  bottomWidth: { x: 200, y: 700 },
  bottomHem: { x: 200, y: 752 },
};

export default function ThobeMeasurementSelector({
  values, onChange, readOnly = false, measurementUnit, fabricEstimate,
  showAdvanced: showAdvancedProp, onShowAdvancedChange, rememberAdvanced = true,
}: ThobeMeasurementSelectorProps) {
  const { t } = useTranslation();
  const { isRtl } = useDirection();
  const highlightColor = "#0F6E96";
  // Grid column 1 is the visual right in RTL and the visual left in LTR.
  const sideColumn = (side: 'right' | 'left') =>
    (side === 'right') === isRtl ? 'md:col-start-1' : 'md:col-start-3';
  const estimatedMeters = fabricEstimate && !readOnly
    ? estimateFabricMeters(
        fabricInputFromMeasurements(values, fabricEstimate.fabricWidthCm),
        fabricEstimate.settings
      )
    : null;
  const [activePart, setActivePart] = useState<ThobePart | null>(null);
  const [isInstructionMode, setIsInstructionMode] = useState(false);
  const [activeHint, setActiveHint] = useState<ThobePart | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const activeZone = activePart ? ZONE_OF[activePart] : null;
  // What the person is typing in the focused field, as typed ("20 3/4"); the
  // stored value follows every readable keystroke. dirty: typed in, so on
  // leaving the field the value is rounded to the nearest quarter. An old
  // value only looked at is left exactly as stored.
  const [draft, setDraft] = useState<{ part: ThobePart; text: string; dirty: boolean } | null>(null);
  // "Rounded to 20 ¾", under the field just left, for a moment.
  const [roundedNote, setRoundedNote] = useState<{ part: ThobePart; text: string } | null>(null);
  useEffect(() => {
    if (!roundedNote) return;
    const timer = setTimeout(() => setRoundedNote(null), 2500);
    return () => clearTimeout(timer);
  }, [roundedNote]);
  const fractionWords = {
    quarter: t('measurements.fraction_quarter'),
    half: t('measurements.fraction_half'),
    threeQuarters: t('measurements.fraction_three_quarters'),
  };

  // The advanced section. Open when the parent says so; otherwise when the
  // person opened or closed it here, else when any advanced value is stored
  // (question 1: stored data is never out of sight) or this device last left
  // it open (question 2).
  const advancedFilled = countAdvancedValues(values);
  const [rememberedOpen] = useState(() => (rememberAdvanced ? readShowAdvanced() : false));
  const [ownChoice, setOwnChoice] = useState<boolean | null>(null);
  const showAdvanced = showAdvancedProp ?? ownChoice ?? (advancedFilled > 0 || rememberedOpen);
  const { row: fieldRow, rows } = useMemo(() => fieldRows(showAdvanced), [showAdvanced]);
  const [focusAfterOpen, setFocusAfterOpen] = useState<ThobePart | null>(null);
  const setShowAdvanced = (show: boolean, focus?: ThobePart) => {
    if (showAdvancedProp === undefined) setOwnChoice(show);
    onShowAdvancedChange?.(show);
    if (rememberAdvanced) writeShowAdvanced(show);
    if (show && focus) setFocusAfterOpen(focus);
  };
  // After opening, focus goes to the field asked for (the first advanced one
  // from the button, or the one whose zone was pressed on the drawing).
  useEffect(() => {
    if (!focusAfterOpen || !showAdvanced) return;
    inputRefs.current[focusAfterOpen]?.focus();
    setActivePart(focusAfterOpen);
    setFocusAfterOpen(null);
  }, [focusAfterOpen, showAdvanced]);
  const isShown = (key: ThobePart) => showAdvanced || !ADVANCED.has(key);

  // A zone shared by two fields (the two sleeve lengths, the two neck widths)
  // sends focus to whichever of them is still empty.
  const handleZoneClick = (zone: MeasurementZone) => {
    if (readOnly) return;
    const shown = ZONE_KEYS[zone].filter(isShown);
    // A zone whose fields are all advanced, while they are hidden: open the
    // section and go to its field.
    if (shown.length === 0) {
      setShowAdvanced(true, ZONE_KEYS[zone][0]);
      return;
    }
    const target = shown.find((key) => !(values as any)[key]) ?? shown[0];
    setActivePart(target);
    inputRefs.current[target]?.focus();
  };

  const zoneProps = (zone: MeasurementZone) => ({
    id: `part-${zone}`,
    className: "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand",
    role: "button",
    tabIndex: -1,
    'aria-label': ZONE_KEYS[zone].filter((key) => readOnly || isShown(key)).map((key) => t(measurementLabelKey(key))).join(' / ')
      || ZONE_KEYS[zone].map((key) => t(measurementLabelKey(key))).join(' / '),
    onClick: () => handleZoneClick(zone),
    animate: { opacity: activeZone && activeZone !== zone ? 0.3 : 1 },
  });
  const isOn = (zone: MeasurementZone) => activeZone === zone;
  const zoneFill = (zone: MeasurementZone) => (isOn(zone) ? `${highlightColor}33` : 'transparent');
  const zoneStroke = (zone: MeasurementZone, idle = '#94a3b8') => (isOn(zone) ? highlightColor : idle);

  const storeValue = (part: ThobePart, displayValue: number) => {
    if (readOnly) return;
    onChange({ ...values, [part]: displayUnitToCm(Math.max(0, displayValue), measurementUnit) });
  };
  const storedOf = (part: ThobePart): number => Number((values as Record<string, unknown>)[part]) || 0;

  const handleFocus = (part: ThobePart) => {
    setActivePart(part);
    setRoundedNote(null);
    setDraft({ part, text: formatMeasurement(storedOf(part), measurementUnit), dirty: false });
  };
  const handleType = (part: ThobePart, text: string) => {
    if (readOnly) return;
    setDraft({ part, text, dirty: true });
    const parsed = parseMeasurementInput(text);
    if (parsed !== null) storeValue(part, parsed);
  };
  // Leaving the field: what was typed goes to the nearest quarter (2.2/4), and
  // says so if that changed it. Unreadable text falls back to the last value.
  const handleLeave = (part: ThobePart) => {
    if (draft?.part === part && draft.dirty) {
      const parsed = parseMeasurementInput(draft.text);
      if (parsed !== null && parsed > 0) {
        const quarter = roundToQuarter(parsed);
        if (quarter !== parsed) {
          storeValue(part, quarter);
          setRoundedNote({ part, text: t('measurements.rounded_to', { value: formatMeasurement(displayUnitToCm(quarter, measurementUnit), measurementUnit) }) });
        }
      }
    }
    setDraft((d) => (d?.part === part ? null : d));
  };
  const pickFraction = (part: ThobePart, displayValue: number) => {
    storeValue(part, displayValue);
    setDraft({ part, text: formatMeasurement(displayUnitToCm(displayValue, measurementUnit), measurementUnit), dirty: false });
  };


  return (
    <div data-measurement-selector className={cn(
      "bg-surface rounded-2xl border border-border w-full",
      readOnly ? "flex flex-col items-center p-4 sm:p-8 max-w-md mx-auto" : "p-3 sm:p-5"
    )}>
      {!readOnly && (
        <div className="pb-3 mb-3 border-b border-border flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-black text-content">{t('measurements.visual_selector_title')}</h2>
            <p className="text-sm text-content-muted font-bold truncate">{t('measurements.visual_selector_desc')}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isSpeechRecognitionSupported() && (
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                className="min-h-[40px] flex items-center justify-center gap-1.5 px-3 rounded-xl border border-brand/30 bg-brand/5 text-brand text-sm font-bold hover:bg-brand/10 transition-colors"
              >
                <Mic size={16} /> <span className="hidden sm:inline">{t('measurements.voice_fill_button', 'تعبئة المقاسات بالصوت')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsInstructionMode(!isInstructionMode)}
              title={t('measurements.instructions_mode')}
              aria-pressed={isInstructionMode}
              className={cn("min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl transition-colors", isInstructionMode ? "bg-[var(--seen-warning-bg)] text-warning" : "bg-surface-muted text-content-muted hover:bg-border")}
            >
              <Lightbulb size={20} />
            </button>
          </div>
        </div>
      )}
      {wizardOpen && (
        <VoiceMeasurementWizard values={values} onChange={onChange} onClose={() => setWizardOpen(false)} measurementUnit={measurementUnit} includeAdvanced={showAdvanced} />
      )}

      <div
        // From 768px: [body] [thobe] [sleeve], the field columns a steady
        // 150-190px and the drawing the rest (at least 220px), so neither
        // squeezes. One row per field of the longer side, counting the shown
        // fields only; the advanced button takes the row under the drawing.
        // Under 768px: the drawing on top, the two sides in two columns
        // under it, then the button.
        style={{ '--rows': rows, '--button-row': rows + 2, '--button-row-md': rows + 1 } as React.CSSProperties}
        className={cn(
          !readOnly && "grid grid-cols-2 gap-x-2 gap-y-2 grid-rows-[auto_repeat(var(--rows),auto)_auto] md:grid-cols-[minmax(150px,190px)_minmax(220px,1fr)_minmax(150px,190px)] md:grid-rows-[repeat(var(--rows),auto)_auto] md:gap-x-4 md:items-center",
          readOnly && "w-full"
        )}
      >
      {/* Interactive SVG Section */}
      <div className={cn(
        "relative w-full mx-auto flex flex-col items-center select-none touch-none",
        readOnly ? "max-w-[400px]" : "col-span-2 row-start-1 md:col-span-1 md:col-start-2 md:row-start-1 md:row-span-[var(--rows)] md:h-full md:min-h-0 md:[contain:size]"
      )}>
        <svg
          viewBox="0 0 400 800"
          className={cn("w-auto max-w-full h-auto", readOnly ? "max-h-[70vh]" : "max-h-[28vh] md:max-h-none md:min-h-0 md:flex-1")}
        >
          <defs>
            <linearGradient id="thobeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#f8fafc" />
            </linearGradient>
            
            <linearGradient id="collarGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f1f5f9" />
              <stop offset="100%" stopColor="#e2e8f0" />
            </linearGradient>

            <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="8" stdDeviation="12" floodOpacity="0.06" />
            </filter>
          </defs>

          {/* Base Thobe Body */}
          <motion.path
            d="M200,80 C180,80 160,90 140,105 C120,130 90,170 70,210 L30,480 L80,500 L95,330 C95,330 75,500 50,750 C120,770 280,770 350,750 C325,500 305,330 305,330 L320,500 L370,480 L330,210 C310,170 280,130 260,105 C240,90 220,80 200,80 Z"
            fill="url(#thobeGradient)"
            stroke="#e2e8f0"
            strokeWidth="1"
            animate={{ 
              opacity: activePart ? 0.7 : 1,
            }}
            transition={{ duration: 0.4 }}
          />

          {/* Detailed Placket (Front Opening) */}
          <motion.g animate={{ opacity: activePart ? 0.4 : 1 }}>
            <path
              d="M195,110 L195,350 C195,355 197,358 200,358 C203,358 205,355 205,350 L205,110 Z"
              fill="#ffffff"
              stroke="#cbd5e1"
              strokeWidth="0.5"
            />
            {/* Buttons */}
            {[140, 185, 230, 275, 320].map((y) => (
              <g key={y}>
                <circle cx="200" cy={y} r="3.5" fill="#f8fafc" stroke="#94a3b8" strokeWidth="0.5" />
                <circle cx="200" cy={y} r="1" fill="#64748b" fillOpacity="0.2" />
              </g>
            ))}
            {/* Placket Stitching */}
            <path d="M197,115 L197,345 M203,115 L203,345" stroke="#cbd5e1" strokeWidth="0.3" strokeDasharray="1,1" fill="none" />
          </motion.g>

          {/* Side Pockets (Subtle) */}
          <motion.g animate={{ opacity: activePart ? 0.4 : 1 }}>
            <path d="M85,400 L85,480" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2,2" />
            <path d="M315,400 L315,480" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2,2" />
          </motion.g>

          {/* Interactive areas: one per zone. They are reached by pointer; the
              keyboard goes through the fields themselves, in list order. */}

          {/* Shoulders */}
          <motion.path
            {...zoneProps('shoulder')}
            d="M140,105 C160,90 240,90 260,105 L280,140 L120,140 Z"
            fill={zoneFill('shoulder')}
            stroke={zoneStroke('shoulder', 'transparent')}
            strokeWidth="3"
          />

          {/* Collar / neck: both neck widths */}
          <motion.g {...zoneProps('neck')}>
            <path
              d="M165,80 C185,95 215,95 235,80 L235,110 C215,125 185,125 165,110 Z"
              fill={isOn('neck') ? highlightColor : 'url(#collarGradient)'}
              stroke={zoneStroke('neck')}
              strokeWidth={isOn('neck') ? "3" : "1.5"}
            />
            <circle cx="200" cy="85" r="3" fill={isOn('neck') ? '#fff' : '#64748b'} />
          </motion.g>

          {/* Chest */}
          <motion.path
            {...zoneProps('chest')}
            d="M85,190 L315,190 L325,310 L75,310 Z"
            fill={zoneFill('chest')}
            stroke={zoneStroke('chest', 'transparent')}
            strokeWidth="3"
          />

          {/* Waist */}
          <motion.path
            {...zoneProps('waist')}
            d="M93,350 L307,350 L311,410 L89,410 Z"
            fill={zoneFill('waist')}
            stroke={zoneStroke('waist', 'transparent')}
            strokeWidth="3"
          />

          {/* Bottom width */}
          <motion.path
            {...zoneProps('bottomWidth')}
            d="M57,670 L343,670 L348,728 L52,728 Z"
            fill={zoneFill('bottomWidth')}
            stroke={zoneStroke('bottomWidth', 'transparent')}
            strokeWidth="3"
          />

          {/* Bottom hem */}
          <motion.path
            {...zoneProps('bottomHem')}
            d="M52,734 L348,734 L350,750 C280,770 120,770 50,750 Z"
            fill={zoneFill('bottomHem')}
            stroke={zoneStroke('bottomHem', '#cbd5e1')}
            strokeWidth={isOn('bottomHem') ? "3" : "0.5"}
            strokeDasharray={isOn('bottomHem') ? "none" : "3,2"}
          />

          {/* Sleeves: both sleeve lengths */}
          <motion.g {...zoneProps('sleeve')}>
            <path
              d="M70,180 L10,480 L60,500 L90,210 Z"
              fill={zoneFill('sleeve')}
              stroke={zoneStroke('sleeve')}
              strokeWidth={isOn('sleeve') ? "3" : "0.5"}
              strokeDasharray={isOn('sleeve') ? "none" : "4,2"}
            />
            <path
              d="M330,180 L390,480 L340,500 L310,210 Z"
              fill={zoneFill('sleeve')}
              stroke={zoneStroke('sleeve')}
              strokeWidth={isOn('sleeve') ? "3" : "0.5"}
              strokeDasharray={isOn('sleeve') ? "none" : "4,2"}
            />
          </motion.g>

          {/* Upper sleeve width */}
          <motion.g {...zoneProps('sleeveTop')}>
            <path d="M62,215 L92,228 L88,262 L55,250 Z" fill={zoneFill('sleeveTop')} stroke={zoneStroke('sleeveTop')} strokeWidth={isOn('sleeveTop') ? "3" : "1"} />
            <path d="M338,215 L308,228 L312,262 L345,250 Z" fill={zoneFill('sleeveTop')} stroke={zoneStroke('sleeveTop')} strokeWidth={isOn('sleeveTop') ? "3" : "1"} />
          </motion.g>

          {/* Cuff: sleeve hem and cuff length */}
          <motion.g {...zoneProps('cuff')}>
            <path d="M18,440 L66,458 L60,500 L10,480 Z" fill={zoneFill('cuff')} stroke={zoneStroke('cuff')} strokeWidth={isOn('cuff') ? "3" : "1"} />
            <path d="M382,440 L334,458 L340,500 L390,480 Z" fill={zoneFill('cuff')} stroke={zoneStroke('cuff')} strokeWidth={isOn('cuff') ? "3" : "1"} />
          </motion.g>

          {/* Cuff width: the open end of the cuff */}
          <motion.g {...zoneProps('cuffWidth')}>
            <path d="M10,480 L60,500" stroke={zoneStroke('cuffWidth')} strokeWidth={isOn('cuffWidth') ? "7" : "3"} strokeLinecap="round" fill="none" />
            <path d="M390,480 L340,500" stroke={zoneStroke('cuffWidth')} strokeWidth={isOn('cuffWidth') ? "7" : "3"} strokeLinecap="round" fill="none" />
            {/* Wider transparent hit area */}
            <path d="M10,480 L60,500 M390,480 L340,500" stroke="transparent" strokeWidth="16" fill="none" />
          </motion.g>

          {/* Mid-sleeve width: a band across the middle of each sleeve, between its top and the wrist */}
          <motion.g {...zoneProps('midSleeve')}>
            <path d="M38,340 L77,340 L73,372 L32,370 Z" fill={zoneFill('midSleeve')} stroke={zoneStroke('midSleeve')} strokeWidth={isOn('midSleeve') ? "3" : "1"} />
            <path d="M362,340 L323,340 L327,372 L368,370 Z" fill={zoneFill('midSleeve')} stroke={zoneStroke('midSleeve')} strokeWidth={isOn('midSleeve') ? "3" : "1"} />
          </motion.g>

          {/* Wrist width */}
          <motion.g {...zoneProps('wrist')}>
            <circle cx="35" cy="520" r="12" fill={zoneFill('wrist')} stroke={zoneStroke('wrist')} strokeWidth={isOn('wrist') ? "3" : "1"} />
            <circle cx="365" cy="520" r="12" fill={zoneFill('wrist')} stroke={zoneStroke('wrist')} strokeWidth={isOn('wrist') ? "3" : "1"} />
          </motion.g>

          {/* Length line */}
          <motion.g {...zoneProps('length')}>
            <line
              x1="200" y1="60" x2="200" y2="760"
              stroke={zoneStroke('length')}
              strokeWidth={isOn('length') ? "6" : "1"}
              strokeDasharray={isOn('length') ? "none" : "10,5"}
            />
            <path d="M190,70 L200,60 L210,70 M190,750 L200,760 L210,750" fill="none" stroke={zoneStroke('length')} strokeWidth="2" />
            {/* Wider transparent hit area */}
            <line x1="200" y1="430" x2="200" y2="660" stroke="transparent" strokeWidth="18" />
          </motion.g>

          {/* Value labels. While editing, only the active field's; sixteen at
              once would bury the drawing. Read-only shows one per zone. */}
          <AnimatePresence>
            {(readOnly
              ? (Object.keys(ZONE_KEYS) as MeasurementZone[]).map((zone) => ({
                  zone,
                  key: ZONE_KEYS[zone].find((k) => Number((values as any)[k]) > 0),
                }))
              : [{ zone: activeZone, key: activePart }]
            ).map(({ zone, key }) => {
              const val = key ? Number((values as any)[key]) : 0;
              if (!zone || !key || !(val > 0)) return null;
              const coords = ZONE_LABEL_AT[zone];
              return (
                <motion.g
                  key={`label-${zone}`}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="pointer-events-none"
                >
                  <rect
                    x={coords.x - 30} y={coords.y - 15}
                    width="60" height="30" rx="15"
                    fill={highlightColor}
                    style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))' }}
                  />
                  <text x={coords.x} y={coords.y + 5} textAnchor="middle" fill="white" fontSize="16" fontWeight="700" direction="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {/* Isolated left-to-right, so ¾ stays after the 20 in Arabic. */}
                    {`\u2066${formatMeasurement(val, measurementUnit)}\u2069`}
                  </text>
                </motion.g>
              );
            })}
          </AnimatePresence>
        </svg>

        {fabricEstimate && !readOnly && (
          <p role="status" className="mt-2 text-center text-sm font-black text-brand select-text" dir="auto">
            {estimatedMeters === null
              ? <span className="text-sm font-bold text-content-muted">{t('measurements.fabric_estimate_missing')}</span>
              : t('measurements.fabric_estimate_line', { meters: estimatedMeters.toFixed(2), yards: metersToYards(estimatedMeters).toFixed(2) })}
          </p>
        )}
        <div className={readOnly ? "mt-8" : "mt-2"}>
          <Branding className="shrink-0 opacity-70 transition-opacity hover:opacity-100" />
        </div>
      </div>

      {/* The fields, beside what they measure (body side down, then sleeve side down) */}
      {!readOnly && DOM_ORDER.map((part) => {
        const { side, tier } = FIELD_OF[part];
        const isActive = activePart === part;
        const stored = storedOf(part);
        const hintOpen = isInstructionMode && activeHint === part;
        const hidden = !isShown(part);
        const label = t(measurementLabelKey(part));
        const shownText = draft?.part === part ? draft.text : formatMeasurement(stored, measurementUnit);
        // From 768px each card's text leans toward the drawing: the body side
        // (right of it) to the left, the sleeve side to the right.
        const leansLeft = side === 'right';
        const inward = leansLeft === isRtl ? 'md:justify-end' : 'md:justify-start';
        const column = (side === 'right') === isRtl ? 'col-start-1 md:col-start-1' : 'col-start-2 md:col-start-3';
        const typedValue = draft?.part === part ? parseMeasurementInput(draft.text) : null;
        return (
          <div
            key={part}
            id={`thobe-field-${part}`}
            // Hidden, not removed: the button's aria-controls points at it, and the value stays in the form.
            hidden={hidden}
            onBlur={(e) => {
              // Keep the field active while focus moves to its own fraction buttons.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                handleLeave(part);
                setActivePart(null);
              }
            }}
            onClick={() => inputRefs.current[part]?.focus()}
            style={{ '--field-row': (fieldRow[part] ?? 1) + 1, '--field-row-md': fieldRow[part] ?? 1 } as React.CSSProperties}
            className={cn(
              "relative flex h-16 cursor-text flex-col justify-center gap-0.5 rounded-[8px] border bg-surface px-3 transition-colors",
              "row-start-[var(--field-row)] md:row-start-[var(--field-row-md)]",
              tier === 'advanced' && "motion-safe:animate-[seen-enter-fade_200ms_cubic-bezier(.2,.8,.2,1)]",
              isActive
                ? "z-10 border-brand shadow-[0_0_0_2px_#FFFFFF,0_0_0_4px_var(--seen-blue-600)]"
                : "border-border hover:border-[var(--seen-neutral-500)]",
              column
            )}
          >
            <div className={cn("flex min-w-0 items-center gap-1.5", inward)}>
              {stored > 0 && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-brand" />}
              <label
                htmlFor={`thobe-part-${part}`}
                // The whole name, never cut: a long one (an English label) takes a smaller size.
                className={cn("min-w-0 break-words font-sans font-medium text-content", label.length > 16 ? "text-sm leading-4" : "text-base leading-5")}
              >
                {label}
              </label>
              {isInstructionMode && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('measurements.instructions_mode')}
                  aria-expanded={hintOpen}
                  onClick={(e) => { e.stopPropagation(); setActiveHint(hintOpen ? null : part); }}
                  className={cn("shrink-0 rounded-full transition-colors text-warning", hintOpen ? "bg-warning/10" : "hover:bg-warning/10")}
                >
                  <Lightbulb size={14} />
                </button>
              )}
            </div>

            <div className={cn("flex min-w-0 items-baseline gap-1", inward)}>
              <input
                id={`thobe-part-${part}`}
                ref={(el) => { inputRefs.current[part] = el; }}
                // Text, not number: the value reads "20 ¾", and a person may type
                // "20 3/4", "20¾", "٢٠٫٧٥" or "20,5" (measurementUnits.parseMeasurementInput).
                // Range checks stay in the zod schema and on the server.
                type="text"
                inputMode="decimal"
                dir="ltr"
                autoComplete="off"
                value={shownText}
                aria-description={stored > 0 && !isActive ? `${spokenMeasurement(stored, measurementUnit, fractionWords)} ${t(unitLabelKey(measurementUnit))}` : undefined}
                onChange={(e) => handleType(part, e.target.value)}
                onFocus={() => handleFocus(part)}
                placeholder="—"
                // Sized to its text, so the value and its unit sit together on the leaning side.
                style={{ width: `${Math.max(2, shownText.length + 1)}ch` }}
                className={cn(
                  "h-6 min-h-0 min-w-0 max-w-full border-0 bg-transparent p-0 focus-visible:shadow-none font-heading text-lg font-bold leading-6 text-content tabular-nums",
                  "placeholder:text-content-muted/50 focus:outline-none focus:ring-0"
                )}
              />
              <span className="shrink-0 text-sm text-content-muted">{t(unitLabelKey(measurementUnit))}</span>
            </div>

            {(isActive || hintOpen || roundedNote?.part === part) && (
              // Floats under the card, so the other fields never shift. It grows
              // toward the drawing (or the other column): right-anchored on the
              // body side, left-anchored on the sleeve side.
              // preventDefault keeps focus in the input while a fraction is tapped.
              <div
                className={cn("absolute top-full z-20 mt-1 flex w-max max-w-[calc(100vw-2rem)] flex-col gap-1", side === 'right' ? "right-0 items-end" : "left-0 items-start")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => e.stopPropagation()}
              >
                {hintOpen && (
                  <p className="w-56 max-w-full rounded-[8px] border border-warning/30 bg-surface p-2 text-sm font-medium leading-relaxed text-warning shadow-[var(--seen-shadow-float)]">
                    {t(measurementHintKey(part))}
                  </p>
                )}
                {isActive && (
                  <FractionPicker
                    value={typedValue ?? (stored ? cmToDisplayUnit(stored, measurementUnit) : 0)}
                    onSelect={(newValue) => pickFraction(part, newValue)}
                    className="gap-1 rounded-[8px] border border-border bg-surface p-1 shadow-[var(--seen-shadow-float)]"
                    buttonClassName="h-11 w-11 rounded-[8px] text-lg"
                    buttonTabIndex={-1}
                  />
                )}
                {!isActive && roundedNote?.part === part && (
                  <p role="status" className="rounded-[8px] border border-border bg-surface px-2 py-1 text-sm text-content-muted shadow-[var(--seen-shadow-float)]">
                    <bdi>{roundedNote.text}</bdi>
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {!readOnly && (
        // Under the drawing from 768px; after the fields on a phone. A
        // secondary button: the one primary button on the screen is saving.
        <div className="col-span-2 row-start-[var(--button-row)] flex justify-center md:col-span-1 md:col-start-2 md:row-start-[var(--button-row-md)] md:pt-1">
          <button
            type="button"
            aria-expanded={showAdvanced}
            aria-controls={ADVANCED_MEASUREMENT_KEYS.map((key) => `thobe-field-${key}`).join(' ')}
            onClick={() => setShowAdvanced(!showAdvanced, showAdvanced ? undefined : FIRST_ADVANCED)}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[8px] border border-[var(--seen-neutral-500)] bg-surface px-4 font-sans text-base font-semibold text-content hover:bg-surface-muted md:w-auto"
          >
            <span>{showAdvanced ? t('measurements.advanced_hide') : t('measurements.advanced_show')}</span>
            {advancedFilled > 0 ? (
              <span className="rounded-full bg-[#DAF1FF] px-2 text-sm font-medium leading-6 text-brand">{t('measurements.advanced_filled', { count: advancedFilled })}</span>
            ) : (
              <span className="rounded-full bg-surface-muted px-2 text-sm font-medium leading-6 text-content-muted tabular-nums">{ADVANCED_MEASUREMENT_KEYS.length}</span>
            )}
            <ChevronDown size={18} aria-hidden="true" className={cn('shrink-0 transition-transform duration-200 motion-reduce:transition-none', showAdvanced && 'rotate-180')} />
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
