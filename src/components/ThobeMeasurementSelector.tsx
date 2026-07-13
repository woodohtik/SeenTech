import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lightbulb } from 'lucide-react';
import { cn } from '../lib/utils';
import { Measurements } from '../types';
import Branding from './Branding';

interface ThobeMeasurementSelectorProps {
  values: Measurements;
  onChange: (values: Measurements) => void;
}

type ThobePart = 'neck' | 'chest' | 'waist' | 'hips' | 'shoulder' | 'sleeve' | 'length' | 'bottomWidth';

const PART_LABELS: Record<ThobePart, string> = {
  neck: 'مقاس الرقبة',
  chest: 'مقاس الصدر',
  waist: 'مقاس الخصر',
  hips: 'مقاس الأرداف',
  shoulder: 'مقاس الأكتاف',
  sleeve: 'مقاس الأكمام',
  length: 'الطول الكلي',
  bottomWidth: 'وسع الأسفل',
};

const PART_HINTS: Record<ThobePart, string> = {
  neck: 'قم بقياس محيط الرقبة مع ترك مسافة إصبعين للراحة.',
  chest: 'قم بقياس محيط الصدر تحت الإبطين في أوسع نقطة.',
  waist: 'قم بقياس محيط الخصر في أضيق نقطة.',
  hips: 'قم بقياس محيط الأرداف في أوسع نقطة.',
  shoulder: 'من عظمة الكتف الأيمن إلى الأيسر من الخلف.',
  sleeve: 'من عظمة الكتف وحتى المعصم.',
  length: 'من أعلى نقطة في الكتف حتى الطول المطلوب.',
  bottomWidth: 'عرض الثوب من الأسفل.'
};

export default function ThobeMeasurementSelector({ values, onChange }: ThobeMeasurementSelectorProps) {
  const [activePart, setActivePart] = useState<ThobePart | null>(null);
  const [isInstructionMode, setIsInstructionMode] = useState(false);
  const [activeHint, setActiveHint] = useState<ThobePart | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handlePartClick = (part: ThobePart) => {
    setActivePart(part);
    inputRefs.current[part]?.focus();
  };

  const handleInputChange = (part: ThobePart, value: string) => {
    const numValue = Math.max(0, parseFloat(value) || 0);
    onChange({ ...values, [part]: numValue });
  };

  const highlightColor = "#1C8FFF";
  const dimColor = "rgba(0, 0, 0, 0.1)";

  return (
    <div className="flex flex-col lg:flex-row items-center lg:items-start gap-8 bg-surface p-6 sm:p-8 rounded-[2rem] border border-border shadow-xl shadow-brand/5 w-full">
      {/* Interactive SVG Section */}
      <div className="relative w-full max-w-[400px] mx-auto flex flex-col items-center select-none touch-none">
        <svg 
          viewBox="0 0 400 800" 
          className="w-full h-auto drop-shadow-lg"
          style={{ 
            maxHeight: '70vh',
            filter: 'drop-shadow(0 20px 40px rgba(0,0,0,0.05))'
          }}
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
            className="cursor-pointer"
            onClick={() => handlePartClick('shoulder')}
            whileHover={{ fill: `${highlightColor}11` }}
            animate={{ 
              opacity: activePart && activePart !== 'shoulder' ? 0.3 : 1,
            }}
          />

          {/* Collar / Neck */}
          <motion.g 
            id="part-neck"
            className="cursor-pointer"
            onClick={() => handlePartClick('neck')}
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
            className="cursor-pointer"
            onClick={() => handlePartClick('chest')}
            whileHover={{ fill: `${highlightColor}11` }}
            animate={{ 
              opacity: activePart && activePart !== 'chest' ? 0.3 : 1,
            }}
          />

          {/* Waist Area */}
          <motion.path
            id="part-waist"
            d="M75,310 L325,310 L315,400 L85,400 Z"
            fill={activePart === 'waist' ? `${highlightColor}33` : 'transparent'}
            stroke={activePart === 'waist' ? highlightColor : 'transparent'}
            strokeWidth="3"
            className="cursor-pointer"
            onClick={() => handlePartClick('waist')}
            whileHover={{ fill: `${highlightColor}11` }}
            animate={{ 
              opacity: activePart && activePart !== 'waist' ? 0.3 : 1,
            }}
          />

          {/* Hips Area */}
          <motion.path
            id="part-hips"
            d="M85,400 L315,400 L295,500 L105,500 Z"
            fill={activePart === 'hips' ? `${highlightColor}33` : 'transparent'}
            stroke={activePart === 'hips' ? highlightColor : 'transparent'}
            strokeWidth="3"
            className="cursor-pointer"
            onClick={() => handlePartClick('hips')}
            whileHover={{ fill: `${highlightColor}11` }}
            animate={{ 
              opacity: activePart && activePart !== 'hips' ? 0.3 : 1,
            }}
          />

          {/* Sleeves with Cuffs */}
          <motion.g 
            id="part-sleeve" 
            className="cursor-pointer"
            onClick={() => handlePartClick('sleeve')}
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

          {/* Length Measurement Line */}
          <motion.g
            id="part-length"
            className="cursor-pointer"
            onClick={() => handlePartClick('length')}
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

          {/* Bottom Width Area */}
          <motion.path
            id="part-bottomWidth"
            d="M40,750 C140,770 260,770 360,750 L365,790 C260,810 140,810 35,790 Z"
            fill={activePart === 'bottomWidth' ? `${highlightColor}33` : 'transparent'}
            stroke={activePart === 'bottomWidth' ? highlightColor : '#94a3b8'}
            strokeWidth={activePart === 'bottomWidth' ? "3" : "1"}
            strokeDasharray={activePart === 'bottomWidth' ? "none" : "5,3"}
            className="cursor-pointer"
            onClick={() => handlePartClick('bottomWidth')}
            whileHover={{ fill: `${highlightColor}11` }}
            animate={{ 
              opacity: activePart && activePart !== 'bottomWidth' ? 0.3 : 1,
            }}
          />

          {/* Value Labels */}
          <AnimatePresence>
            {Object.entries(values).map(([key, val]) => {
              if (val === 0 || val === undefined || val === null) return null;
              
              let coords = { x: 0, y: 0 };
              switch(key) {
                case 'neck': coords = { x: 200, y: 90 }; break;
                case 'shoulder': coords = { x: 200, y: 145 }; break;
                case 'chest': coords = { x: 200, y: 270 }; break;
                case 'waist': coords = { x: 200, y: 350 }; break;
                case 'hips': coords = { x: 200, y: 430 }; break;
                case 'sleeve': coords = { x: 50, y: 350 }; break;
                case 'length': coords = { x: 240, y: 500 }; break;
                case 'bottomWidth': coords = { x: 200, y: 780 }; break;
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
                    {val}
                  </text>
                </motion.g>
              );
            })}
          </AnimatePresence>
        </svg>

        <div className="mt-8">
          <Branding className="shrink-0 opacity-70 transition-opacity hover:opacity-100" />
        </div>
      </div>

      {/* Input Form Section */}
      <div className="w-full lg:w-[350px] space-y-6">
        <div className="pb-4 border-b border-border flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-black text-content">مُحدد المقاسات البصري</h2>
            <p className="text-sm text-content-muted font-bold">أدخل المقاسات بدقة للمراجعة الفورية</p>
          </div>
          <button 
            onClick={() => setIsInstructionMode(!isInstructionMode)}
            title="وضع التعليمات"
            className={cn("p-2.5 rounded-xl transition-colors shrink-0", isInstructionMode ? "bg-amber-100 text-amber-600" : "bg-surface-muted text-content-muted hover:bg-border")}
          >
            <Lightbulb size={24} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {(Object.keys(PART_LABELS) as ThobePart[]).map((part) => (
            <div 
              key={part}
              className={cn(
                "p-4 rounded-2xl border-2 transition-all duration-300",
                activePart === part 
                  ? "border-brand bg-brand/5 shadow-lg shadow-brand/5" 
                  : "border-border bg-surface hover:border-brand/30"
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[10px] font-black text-content-muted uppercase tracking-widest">
                  {PART_LABELS[part]}
                </label>
                {isInstructionMode && (
                  <button 
                    onClick={() => setActiveHint(activeHint === part ? null : part)}
                    className={cn("p-1.5 rounded-full transition-colors", activeHint === part ? "text-amber-600 bg-amber-100" : "text-amber-500 hover:bg-amber-50")}
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
                    className="overflow-hidden mb-3"
                  >
                    <p className="text-xs text-amber-700 bg-amber-50/80 p-2.5 rounded-xl font-bold leading-relaxed border border-amber-100/50">
                      {PART_HINTS[part]}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-center gap-3">
                <input
                  ref={(el) => { inputRefs.current[part] = el; }}
                  type="number"
                  min="0"
                  step="0.1"
                  value={(values as any)[part] || ''}
                  onChange={(e) => handleInputChange(part, e.target.value)}
                  onFocus={() => setActivePart(part)}
                  onBlur={() => setActivePart(null)}
                  placeholder="0.0"
                  className="w-full bg-transparent border-none p-0 text-3xl font-black text-content focus:ring-0 placeholder:text-content-muted/30"
                />
                <span className="text-sm font-bold text-content-muted">سم</span>
              </div>
            </div>
          ))}
        </div>

        <div className="pt-4">
          <div className="p-4 bg-brand/10 rounded-2xl border border-brand/20">
            <p className="text-xs font-bold text-brand leading-relaxed">
              * يتم حفظ هذه المقاسات تلقائياً ككائن JSON مرتبط ببيانات العميل والطلب لضمان دقة التفصيل.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
