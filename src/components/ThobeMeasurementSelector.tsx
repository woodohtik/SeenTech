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
import { MEASUREMENT_WIZARD_ORDER } from '../utils/measurementWizardSteps';
import { estimateFabricMeters, metersToYards, type FabricEstimateSettings } from '../utils/fabricEstimate';

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

type ThobePart = 'neck' | 'chest' | 'shoulder' | 'sleeve' | 'length' | 'handWidth' | 'midSleeveWidth' | 'cuffLength';

export const PART_LABELS: Record<ThobePart, string> = {
  length: 'measurements.part_label.length',
  shoulder: 'measurements.part_label.shoulder',
  sleeve: 'measurements.part_label.sleeve',
  chest: 'measurements.part_label.chest',
  neck: 'measurements.part_label.neck',
  handWidth: 'measurements.part_label.handWidth',
  midSleeveWidth: 'measurements.part_label.midSleeveWidth',
  cuffLength: 'measurements.part_label.cuffLength',
};

// Where each field sits around the figure from 768px up: four on the figure's
// right, four on its left, each on the row closest to its spot on the drawing.
// DOM order stays MEASUREMENT_WIZARD_ORDER so Tab follows the measuring order.
const PART_SIDE: Record<ThobePart, 'right' | 'left'> = {
  neck: 'right', shoulder: 'right', chest: 'right', length: 'right',
  sleeve: 'left', midSleeveWidth: 'left', cuffLength: 'left', handWidth: 'left',
};
const PART_ROW: Record<ThobePart, string> = {
  neck: 'md:row-start-1', shoulder: 'md:row-start-2', chest: 'md:row-start-3', length: 'md:row-start-4',
  sleeve: 'md:row-start-1', midSleeveWidth: 'md:row-start-2', cuffLength: 'md:row-start-3', handWidth: 'md:row-start-4',
};

const PART_HINTS: Record<ThobePart, string> = {
  length: 'measurements.part_hint.length',
  shoulder: 'measurements.part_hint.shoulder',
  sleeve: 'measurements.part_hint.sleeve',
  chest: 'measurements.part_hint.chest',
  neck: 'measurements.part_hint.neck',
  handWidth: 'measurements.part_hint.handWidth',
  midSleeveWidth: 'measurements.part_hint.midSleeveWidth',
  cuffLength: 'measurements.part_hint.cuffLength'
};

export default function ThobeMeasurementSelector({ values, onChange, readOnly = false, measurementUnit, fabricEstimate }: ThobeMeasurementSelectorProps) {
  const { t } = useTranslation();
  const { isRtl } = useDirection();
  // Grid column 1 is the visual right in RTL and the visual left in LTR.
  const sideColumn = (side: 'right' | 'left') =>
    (side === 'right') === isRtl ? 'md:col-start-1' : 'md:col-start-3';
  const estimatedMeters = fabricEstimate && !readOnly
    ? estimateFabricMeters(
        { lengthCm: values.length, sleeveCm: values.sleeve, fabricWidthCm: fabricEstimate.fabricWidthCm },
        fabricEstimate.settings
      )
    : null;
  const [activePart, setActivePart] = useState<ThobePart | null>(null);
  const [isInstructionMode, setIsInstructionMode] = useState(false);
  const [activeHint, setActiveHint] = useState<ThobePart | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handlePartClick = (part: ThobePart) => {
    if (readOnly) return;
    setActivePart(part);
    inputRefs.current[part]?.focus();
  };

  const handlePartKeyDown = (part: ThobePart) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handlePartClick(part);
    }
  };

  const handleInputChange = (part: ThobePart, value: string) => {
    if (readOnly) return;
    const numValue = Math.max(0, parseFloat(value) || 0);
    onChange({ ...values, [part]: displayUnitToCm(numValue, measurementUnit) });
  };

  const highlightColor = "#0F6E96";
  const dimColor = "rgba(0, 0, 0, 0.1)";

  return (
    <div className={cn(
      "bg-surface rounded-2xl border border-border shadow-xl shadow-brand/5 w-full",
      readOnly ? "flex flex-col items-center p-4 sm:p-8 max-w-md mx-auto" : "p-3 sm:p-5"
    )}>
      {!readOnly && (
        <div className="pb-3 mb-3 border-b border-border flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-black text-content">{t('measurements.visual_selector_title')}</h2>
            <p className="text-xs text-content-muted font-bold truncate">{t('measurements.visual_selector_desc')}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isSpeechRecognitionSupported() && (
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                className="min-h-[40px] flex items-center justify-center gap-1.5 px-3 rounded-xl border border-brand/30 bg-brand/5 text-brand text-xs font-bold hover:bg-brand/10 transition-colors"
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
        !readOnly && "grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(170px,240px)_minmax(0,1fr)] md:grid-rows-4 md:gap-x-4 md:gap-y-3 md:items-center",
        readOnly && "w-full"
      )}>
      {/* Interactive SVG Section */}
      <div className={cn(
        "relative w-full mx-auto flex flex-col items-center select-none touch-none",
        readOnly ? "max-w-[400px]" : "col-span-2 md:col-span-1 md:col-start-2 md:row-start-1 md:row-span-4"
      )}>
        <svg
          viewBox="0 0 400 800"
          className={cn("w-auto max-w-full h-auto drop-shadow-lg", readOnly ? "max-h-[70vh]" : "max-h-[40vh] md:max-h-[min(58vh,430px)]")}
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

          {/* Interactive Areas */}

          {/* Shoulders Area */}
          <motion.path
            id="part-shoulder"
            d="M140,105 C160,90 240,90 260,105 L280,140 L120,140 Z"
            fill={activePart === 'shoulder' ? `${highlightColor}33` : 'transparent'}
            stroke={activePart === 'shoulder' ? highlightColor : 'transparent'}
            strokeWidth="3"
            className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            role="button"
            tabIndex={readOnly ? -1 : 0}
            aria-label={t(PART_LABELS.shoulder)}
            onClick={() => handlePartClick('shoulder')}
            onKeyDown={handlePartKeyDown('shoulder')}
            whileHover={{ fill: `${highlightColor}11` }}
            animate={{ 
              opacity: activePart && activePart !== 'shoulder' ? 0.3 : 1,
            }}
          />

          {/* Collar / Neck */}
          <motion.g
            id="part-neck"
            className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            role="button"
            tabIndex={readOnly ? -1 : 0}
            aria-label={t(PART_LABELS.neck)}
            onClick={() => handlePartClick('neck')}
            onKeyDown={handlePartKeyDown('neck')}
            animate={{
              opacity: activePart && activePart !== 'neck' ? 0.3 : 1,
              y: activePart === 'neck' ? -5 : 0
            }}
          >
            <path
              d="M165,80 C185,95 215,95 235,80 L235,110 C215,125 185,125 165,110 Z"
              fill={activePart === 'neck' ? highlightColor : 'url(#collarGradient)'}
              stroke={activePart === 'neck' ? highlightColor : '#94a3b8'}
              strokeWidth={activePart === 'neck' ? "3" : "1.5"}
            />
            {/* Collar Button */}
            <circle cx="200" cy="85" r="3" fill={activePart === 'neck' ? '#fff' : '#64748b'} />
          </motion.g>

          {/* Chest Area */}
          <motion.path
            id="part-chest"
            d="M85,190 L315,190 L325,310 L75,310 Z"
            fill={activePart === 'chest' ? `${highlightColor}33` : 'transparent'}
            stroke={activePart === 'chest' ? highlightColor : 'transparent'}
            strokeWidth="3"
            className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            role="button"
            tabIndex={readOnly ? -1 : 0}
            aria-label={t(PART_LABELS.chest)}
            onClick={() => handlePartClick('chest')}
            onKeyDown={handlePartKeyDown('chest')}
            whileHover={{ fill: `${highlightColor}11` }}
            animate={{ 
              opacity: activePart && activePart !== 'chest' ? 0.3 : 1,
            }}
          />

          {/* Sleeves with Cuffs */}
          <motion.g
            id="part-sleeve"
            className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            role="button"
            tabIndex={readOnly ? -1 : 0}
            aria-label={t(PART_LABELS.sleeve)}
            onClick={() => handlePartClick('sleeve')}
            onKeyDown={handlePartKeyDown('sleeve')}
            animate={{
              opacity: activePart && activePart !== 'sleeve' ? 0.3 : 1,
            }}
          >
            {/* Left Sleeve */}
            <path
              d="M70,180 L10,480 L60,500 L90,210 Z"
              fill={activePart === 'sleeve' ? `${highlightColor}33` : 'transparent'}
              stroke={activePart === 'sleeve' ? highlightColor : '#94a3b8'}
              strokeWidth={activePart === 'sleeve' ? "3" : "0.5"}
              strokeDasharray={activePart === 'sleeve' ? "none" : "4,2"}
            />
            {/* Right Sleeve */}
            <path
              d="M330,180 L390,480 L340,500 L310,210 Z"
              fill={activePart === 'sleeve' ? `${highlightColor}33` : 'transparent'}
              stroke={activePart === 'sleeve' ? highlightColor : '#94a3b8'}
              strokeWidth={activePart === 'sleeve' ? "3" : "0.5"}
              strokeDasharray={activePart === 'sleeve' ? "none" : "4,2"}
            />
            {/* Cuff Details */}
            <g opacity="0.6">
              <path d="M10,480 L60,500 M390,480 L340,500" stroke="#94a3b8" strokeWidth="1" />
              <path d="M15,460 L55,475 M385,460 L345,475" stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="1,1" />
            </g>
          </motion.g>

          {/* Hand Width (wrist tips) */}
          <motion.g
            id="part-handWidth"
            className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            role="button"
            tabIndex={readOnly ? -1 : 0}
            aria-label={t(PART_LABELS.handWidth)}
            onClick={() => handlePartClick('handWidth')}
            onKeyDown={handlePartKeyDown('handWidth')}
            animate={{
              opacity: activePart && activePart !== 'handWidth' ? 0.3 : 1,
            }}
          >
            <circle
              cx="35" cy="495" r="12"
              fill={activePart === 'handWidth' ? `${highlightColor}33` : 'transparent'}
              stroke={activePart === 'handWidth' ? highlightColor : '#94a3b8'}
              strokeWidth={activePart === 'handWidth' ? "3" : "1"}
            />
            <circle
              cx="365" cy="495" r="12"
              fill={activePart === 'handWidth' ? `${highlightColor}33` : 'transparent'}
              stroke={activePart === 'handWidth' ? highlightColor : '#94a3b8'}
              strokeWidth={activePart === 'handWidth' ? "3" : "1"}
            />
          </motion.g>

          {/* Mid-Sleeve Width */}
          <motion.g
            id="part-midSleeveWidth"
            className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            role="button"
            tabIndex={readOnly ? -1 : 0}
            aria-label={t(PART_LABELS.midSleeveWidth)}
            onClick={() => handlePartClick('midSleeveWidth')}
            onKeyDown={handlePartKeyDown('midSleeveWidth')}
            animate={{
              opacity: activePart && activePart !== 'midSleeveWidth' ? 0.3 : 1,
            }}
          >
            <circle
              cx="40" cy="330" r="12"
              fill={activePart === 'midSleeveWidth' ? `${highlightColor}33` : 'transparent'}
              stroke={activePart === 'midSleeveWidth' ? highlightColor : '#94a3b8'}
              strokeWidth={activePart === 'midSleeveWidth' ? "3" : "1"}
            />
            <circle
              cx="360" cy="330" r="12"
              fill={activePart === 'midSleeveWidth' ? `${highlightColor}33` : 'transparent'}
              stroke={activePart === 'midSleeveWidth' ? highlightColor : '#94a3b8'}
              strokeWidth={activePart === 'midSleeveWidth' ? "3" : "1"}
            />
          </motion.g>

          {/* Cuff Length */}
          <motion.g
            id="part-cuffLength"
            className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            role="button"
            tabIndex={readOnly ? -1 : 0}
            aria-label={t(PART_LABELS.cuffLength)}
            onClick={() => handlePartClick('cuffLength')}
            onKeyDown={handlePartKeyDown('cuffLength')}
            animate={{
              opacity: activePart && activePart !== 'cuffLength' ? 0.3 : 1,
            }}
          >
            <circle
              cx="35" cy="470" r="12"
              fill={activePart === 'cuffLength' ? `${highlightColor}33` : 'transparent'}
              stroke={activePart === 'cuffLength' ? highlightColor : '#94a3b8'}
              strokeWidth={activePart === 'cuffLength' ? "3" : "1"}
            />
            <circle
              cx="365" cy="470" r="12"
              fill={activePart === 'cuffLength' ? `${highlightColor}33` : 'transparent'}
              stroke={activePart === 'cuffLength' ? highlightColor : '#94a3b8'}
              strokeWidth={activePart === 'cuffLength' ? "3" : "1"}
            />
          </motion.g>

          {/* Length Measurement Line */}
          <motion.g
            id="part-length"
            className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            role="button"
            tabIndex={readOnly ? -1 : 0}
            aria-label={t(PART_LABELS.length)}
            onClick={() => handlePartClick('length')}
            onKeyDown={handlePartKeyDown('length')}
            animate={{
              opacity: activePart && activePart !== 'length' ? 0.3 : 1,
            }}
          >
            <line
              x1="200" y1="60" x2="200" y2="760"
              stroke={activePart === 'length' ? highlightColor : "#94a3b8"}
              strokeWidth={activePart === 'length' ? "6" : "1"}
              strokeDasharray={activePart === 'length' ? "none" : "10,5"}
            />
            {/* Measurement Arrows */}
            <path d="M190,70 L200,60 L210,70 M190,750 L200,760 L210,750" fill="none" stroke={activePart === 'length' ? highlightColor : "#94a3b8"} strokeWidth="2" />
          </motion.g>

          {/* Value Labels */}
          <AnimatePresence>
            {Object.entries(values).map(([key, val]) => {
              if (val === 0 || val === undefined || val === null) return null;
              
              let coords = { x: 0, y: 0 };
              switch(key) {
                case 'neck': coords = { x: 200, y: 90 }; break;
                case 'shoulder': coords = { x: 200, y: 145 }; break;
                case 'chest': coords = { x: 200, y: 270 }; break;
                case 'sleeve': coords = { x: 50, y: 350 }; break;
                case 'length': coords = { x: 240, y: 500 }; break;
                case 'handWidth': coords = { x: 35, y: 495 }; break;
                case 'midSleeveWidth': coords = { x: 40, y: 330 }; break;
                case 'cuffLength': coords = { x: 35, y: 470 }; break;
                default: return null;
              }
              return (
                <motion.g
                  key={`label-${key}`}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  <rect 
                    x={coords.x - 30} y={coords.y - 15} 
                    width="60" height="30" rx="15" 
                    fill={highlightColor}
                    style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))' }}
                  />
                  <text
                    x={coords.x} y={coords.y + 5}
                    textAnchor="middle"
                    fill="white"
                    fontSize="16"
                    fontWeight="900"
                    className="pointer-events-none"
                  >
                    {cmToDisplayUnit(val as number, measurementUnit).toFixed(2)}
                  </text>
                </motion.g>
              );
            })}
          </AnimatePresence>
        </svg>

        {fabricEstimate && !readOnly && (
          <p role="status" className="mt-2 text-center text-sm font-black text-brand select-text" dir="auto">
            {estimatedMeters === null
              ? <span className="text-xs font-bold text-content-muted">{t('measurements.fabric_estimate_missing')}</span>
              : t('measurements.fabric_estimate_line', { meters: estimatedMeters.toFixed(2), yards: metersToYards(estimatedMeters).toFixed(2) })}
          </p>
        )}
        <div className={readOnly ? "mt-8" : "mt-2"}>
          <Branding className="shrink-0 opacity-70 transition-opacity hover:opacity-100" />
        </div>
      </div>

      {/* Input fields, in measuring order; placed around the figure from md up */}
      {!readOnly && MEASUREMENT_WIZARD_ORDER.map((part) => {
        const isActive = activePart === part;
        const stored = (values as any)[part];
        return (
          <div
            key={part}
            onBlur={(e) => {
              // Keep the field active while focus moves to its own fraction buttons.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActivePart(null);
            }}
            className={cn(
              "relative rounded-xl border px-2.5 py-1.5 transition-colors",
              isActive ? "border-brand bg-brand/5" : "border-border bg-surface hover:border-brand/30",
              sideColumn(PART_SIDE[part]),
              PART_ROW[part]
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <label htmlFor={`thobe-part-${part}`} className="block text-[11px] font-black text-content-muted truncate">
                {t(PART_LABELS[part])}
              </label>
              {isInstructionMode && (
                <button
                  type="button"
                  aria-label={t('measurements.instructions_mode')}
                  aria-expanded={activeHint === part}
                  onClick={() => setActiveHint(activeHint === part ? null : part)}
                  className={cn("p-1 rounded-full transition-colors text-warning", activeHint === part ? "bg-warning/10" : "hover:bg-warning/10")}
                >
                  <Lightbulb size={14} />
                </button>
              )}
            </div>

            <AnimatePresence>
              {isInstructionMode && activeHint === part && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <p className="text-xs text-warning bg-warning/10 p-2 my-1 rounded-lg font-bold leading-relaxed border border-warning/20">
                    {t(PART_HINTS[part])}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

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
                className="w-full min-w-0 h-10 bg-transparent border-none p-0 text-lg font-black text-content focus:ring-0 focus:outline-none placeholder:text-content-muted/30"
              />
              <span className="text-xs font-bold text-content-muted shrink-0">{t(unitLabelKey(measurementUnit))}</span>
            </div>
            {isActive && (
              // Floats under the active field only, so the other fields never shift.
              // preventDefault keeps focus in the input while a fraction is tapped.
              <div
                className="absolute inset-x-0 top-full z-20 mt-1 flex justify-center"
                onMouseDown={(e) => e.preventDefault()}
              >
                <FractionPicker
                  value={stored ? cmToDisplayUnit(stored, measurementUnit) : 0}
                  onSelect={(newValue) => handleInputChange(part, String(newValue))}
                  className="bg-surface border border-border rounded-xl p-1 shadow-lg"
                  buttonTabIndex={-1}
                />
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
