import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { Lightbulb, Mic } from 'lucide-react';
import { cn } from '../lib/utils';
import { Measurements } from '../types';
import Branding from './Branding';
import VoiceMeasurementWizard from './VoiceMeasurementWizard';
import { isSpeechRecognitionSupported } from '../hooks/useSpeechRecognition';
import { MeasurementUnit, cmToDisplayUnit, displayUnitToCm, unitLabelKey } from '../utils/measurementUnits';
import { FractionPicker } from './ui/FractionPicker';
import { useDirection } from '../lib/direction';
import {
  MEASUREMENT_FIELDS,
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
}

type ThobePart = MeasurementKey;

// Each field's row inside its own column (body on the right, sleeve and cuff
// on the left), in list order. DOM order stays the list order so Tab follows it.
const FIELD_ROW: Record<string, number> = {};
{
  const next = { right: 1, left: 1 };
  for (const field of MEASUREMENT_FIELDS) FIELD_ROW[field.key] = next[field.side]++;
}
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
  sleeve: { x: 50, y: 350 },
  sleeveTop: { x: 62, y: 240 },
  wrist: { x: 35, y: 520 },
  cuff: { x: 35, y: 440 },
  cuffWidth: { x: 365, y: 520 },
  length: { x: 240, y: 560 },
  bottomWidth: { x: 200, y: 700 },
  bottomHem: { x: 200, y: 752 },
};

export default function ThobeMeasurementSelector({ values, onChange, readOnly = false, measurementUnit, fabricEstimate }: ThobeMeasurementSelectorProps) {
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

  // A zone shared by two fields (the two sleeve lengths, the two neck widths)
  // sends focus to whichever of them is still empty.
  const handleZoneClick = (zone: MeasurementZone) => {
    if (readOnly) return;
    const keys = ZONE_KEYS[zone];
    const target = keys.find((key) => !(values as any)[key]) ?? keys[0];
    setActivePart(target);
    inputRefs.current[target]?.focus();
  };

  const zoneProps = (zone: MeasurementZone) => ({
    id: `part-${zone}`,
    className: "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand",
    role: "button",
    tabIndex: -1,
    'aria-label': ZONE_KEYS[zone].map((key) => t(measurementLabelKey(key))).join(' / '),
    onClick: () => handleZoneClick(zone),
    animate: { opacity: activeZone && activeZone !== zone ? 0.3 : 1 },
  });
  const isOn = (zone: MeasurementZone) => activeZone === zone;
  const zoneFill = (zone: MeasurementZone) => (isOn(zone) ? `${highlightColor}33` : 'transparent');
  const zoneStroke = (zone: MeasurementZone, idle = '#94a3b8') => (isOn(zone) ? highlightColor : idle);

  const handleInputChange = (part: ThobePart, value: string) => {
    if (readOnly) return;
    const numValue = Math.max(0, parseFloat(value) || 0);
    onChange({ ...values, [part]: displayUnitToCm(numValue, measurementUnit) });
  };


  return (
    <div className={cn(
      "bg-surface rounded-2xl border border-border shadow-xl shadow-brand/5 w-full",
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
              className={cn("min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl transition-colors", isInstructionMode ? "bg-warning/10 text-warning" : "bg-surface-muted text-content-muted hover:bg-border")}
            >
              <Lightbulb size={20} />
            </button>
          </div>
        </div>
      )}
      {wizardOpen && (
        <VoiceMeasurementWizard values={values} onChange={onChange} onClose={() => setWizardOpen(false)} measurementUnit={measurementUnit} />
      )}

      <div className={cn(
        !readOnly && "grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(170px,230px)_minmax(0,1fr)] md:grid-rows-8 md:gap-x-4 md:gap-y-1.5 md:items-center",
        readOnly && "w-full"
      )}>
      {/* Interactive SVG Section */}
      <div className={cn(
        "relative w-full mx-auto flex flex-col items-center select-none touch-none",
        readOnly ? "max-w-[400px]" : "col-span-2 md:col-span-1 md:col-start-2 md:row-start-1 md:row-span-8"
      )}>
        <svg
          viewBox="0 0 400 800"
          className={cn("w-auto max-w-full h-auto drop-shadow-lg", readOnly ? "max-h-[70vh]" : "max-h-[35vh] md:max-h-[min(58vh,430px)]")}
          style={{ filter: 'drop-shadow(0 20px 40px rgba(0,0,0,0.05))' }}
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

          {/* Value labels. While editing, only the active field's; fifteen at
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
                  <text x={coords.x} y={coords.y + 5} textAnchor="middle" fill="white" fontSize="16" fontWeight="900">
                    {cmToDisplayUnit(val, measurementUnit).toFixed(2)}
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

      {/* Input fields in list order; placed around the figure from md up */}
      {!readOnly && MEASUREMENT_FIELDS.map(({ key: part, side }) => {
        const isActive = activePart === part;
        const stored = (values as any)[part];
        const hintOpen = isInstructionMode && activeHint === part;
        return (
          <div
            key={part}
            onBlur={(e) => {
              // Keep the field active while focus moves to its own fraction buttons.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActivePart(null);
            }}
            style={{ '--field-row': FIELD_ROW[part] } as React.CSSProperties}
            className={cn(
              "relative rounded-xl border px-2.5 py-1 transition-colors md:row-start-[var(--field-row)]",
              isActive ? "border-brand bg-brand/5" : "border-border bg-surface hover:border-brand/30",
              sideColumn(side)
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <label htmlFor={`thobe-part-${part}`} className="block text-sm leading-4 font-black text-content-muted truncate">
                {t(measurementLabelKey(part))}
              </label>
              {isInstructionMode && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('measurements.instructions_mode')}
                  aria-expanded={hintOpen}
                  onClick={() => setActiveHint(hintOpen ? null : part)}
                  className={cn("rounded-full transition-colors text-warning", hintOpen ? "bg-warning/10" : "hover:bg-warning/10")}
                >
                  <Lightbulb size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <input
                id={`thobe-part-${part}`}
                ref={(el) => { inputRefs.current[part] = el; }}
                type="number"
                min="0"
                inputMode="decimal"
                // No fixed step here on purpose. step="0.1" originally rejected
                // the FractionPicker's own quarter values (20.75 isn't a
                // multiple of 0.1) as an HTML5 step mismatch and silently
                // blocked the whole form's native submit; step="0.25" to match
                // the picker turned out to be just as fragile, because the
                // DISPLAYED value isn't only ever a clean quarter -- it's
                // cmToDisplayUnit() converting whatever was actually stored in
                // cm, and that inch<->cm round trip routinely lands on an
                // "ugly" decimal (e.g. 59.06) that matches neither step. Real
                // range validation already happens server-side and in the zod
                // schema (min/max); step="any" just stops the browser from
                // blocking a save over its own unrelated divisibility opinion.
                step="any"
                value={
                  stored
                    ? (isActive
                        ? cmToDisplayUnit(stored, measurementUnit)
                        : cmToDisplayUnit(stored, measurementUnit).toFixed(2))
                    : ''
                }
                onChange={(e) => handleInputChange(part, e.target.value)}
                onFocus={() => setActivePart(part)}
                placeholder="0.0"
                className="w-full min-w-0 h-7 min-h-0 bg-transparent border-none p-0 text-lg font-black text-content focus:ring-0 focus:outline-none placeholder:text-content-muted/30"
              />
              <span className="text-sm font-bold text-content-muted shrink-0">{t(unitLabelKey(measurementUnit))}</span>
            </div>
            {(isActive || hintOpen) && (
              // Floats under the field, so the other fields never shift.
              // preventDefault keeps focus in the input while a fraction is tapped.
              <div
                className="absolute inset-x-0 top-full z-20 mt-1 flex flex-col items-center gap-1"
                onMouseDown={(e) => e.preventDefault()}
              >
                {hintOpen && (
                  <p className="w-full text-sm text-warning bg-surface p-2 rounded-lg font-bold leading-relaxed border border-warning/30 shadow-lg">
                    {t(measurementHintKey(part))}
                  </p>
                )}
                {isActive && (
                  <FractionPicker
                    value={stored ? cmToDisplayUnit(stored, measurementUnit) : 0}
                    onSelect={(newValue) => handleInputChange(part, String(newValue))}
                    className="bg-surface border border-border rounded-xl p-1 shadow-lg"
                    buttonTabIndex={-1}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
