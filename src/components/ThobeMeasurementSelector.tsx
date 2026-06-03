import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { ThobeMeasurements } from '../types';
import Branding from './Branding';

interface ThobeMeasurementSelectorProps {
  values: ThobeMeasurements;
  onChange: (values: ThobeMeasurements) => void;
}

type ThobePart = keyof ThobeMeasurements;

const PART_LABELS: Record<ThobePart, string> = {
  collar: 'مقاس الرقبة',
  chest: 'مقاس الصدر',
  shoulders: 'مقاس الأكتاف',
  sleeves: 'مقاس الأكمام',
  length: 'الطول الكلي',
  bottomWidth: 'وسع الأسفل',
};

export default function ThobeMeasurementSelector({ values, onChange }: ThobeMeasurementSelectorProps) {
  const [activePart, setActivePart] = useState<ThobePart | null>(null);
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
  const strokeColor = "#333";

  return (
    <div className="flex flex-col lg:flex-row gap-4 md:gap-8 p-4 md:p-8 bg-white rounded-3xl md:rounded-[3rem] border border-slate-100 shadow-xl relative overflow-hidden" dir="rtl">
      {/* Visual SVG Section */}
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-50/50 rounded-2xl md:rounded-[2.5rem] p-4 md:p-12 min-h-[400px] md:min-h-[900px] relative border border-slate-100/50">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
        <svg 
          viewBox="0 0 400 800" 
          className="w-full h-auto"
          style={{ maxHeight: '850px' }}
        >
          <defs>
            <linearGradient id="thobeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="50%" stopColor="#fcfdfe" />
              <stop offset="100%" stopColor="#f5f7fa" />
            </linearGradient>
            <linearGradient id="collarGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#f0f2f5" />
            </linearGradient>
            <filter id="realisticShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="8" />
              <feOffset dx="0" dy="4" result="offsetblur" />
              <feComponentTransfer>
                <feFuncA type="linear" slope="0.15" />
              </feComponentTransfer>
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background Shadow */}
          <ellipse cx="200" cy="760" rx="150" ry="20" fill="rgba(0,0,0,0.05)" />

          {/* Main Thobe Body - Professional Silhouette */}
          <motion.path
            id="thobe-body"
            d="M135,110 C135,110 160,100 200,100 C240,100 265,110 265,110 L330,180 C330,180 345,400 360,750 C260,770 140,770 40,750 C55,400 70,180 70,180 Z"
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

          {/* Interactive Parts */}
          
          {/* Shoulders */}
          <motion.path
            id="part-shoulders"
            d="M135,110 L265,110 L330,180 L70,180 Z"
            fill={activePart === 'shoulders' ? `${highlightColor}33` : 'transparent'}
            stroke={activePart === 'shoulders' ? highlightColor : 'transparent'}
            strokeWidth="3"
            className="cursor-pointer"
            onClick={() => handlePartClick('shoulders')}
            whileHover={{ fill: `${highlightColor}11` }}
            animate={{ 
              opacity: activePart && activePart !== 'shoulders' ? 0.3 : 1,
            }}
          />

          {/* Collar (Saudi Sada Style) */}
          <motion.g
            id="part-collar"
            className="cursor-pointer"
            onClick={() => handlePartClick('collar')}
            animate={{ 
              opacity: activePart && activePart !== 'collar' ? 0.3 : 1,
              y: activePart === 'collar' ? -5 : 0
            }}
          >
            <path
              d="M165,70 C165,70 180,60 200,60 C220,60 235,70 235,70 L250,115 C250,115 200,125 150,115 Z"
              fill={activePart === 'collar' ? highlightColor : 'url(#collarGradient)'}
              stroke={activePart === 'collar' ? highlightColor : '#94a3b8'}
              strokeWidth={activePart === 'collar' ? "3" : "1.5"}
              style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.05))' }}
            />
            <circle cx="200" cy="85" r="3" fill={activePart === 'collar' ? '#fff' : '#64748b'} />
          </motion.g>

          {/* Chest Area */}
          <motion.path
            id="part-chest"
            d="M85,190 L315,190 L325,350 L75,350 Z"
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

          {/* Sleeves with Cuffs */}
          <motion.g 
            id="part-sleeves" 
            className="cursor-pointer"
            onClick={() => handlePartClick('sleeves')}
            animate={{ 
              opacity: activePart && activePart !== 'sleeves' ? 0.3 : 1,
            }}
          >
            {/* Left Sleeve */}
            <path
              d="M70,180 L10,480 L60,500 L90,210 Z"
              fill={activePart === 'sleeves' ? `${highlightColor}33` : 'transparent'}
              stroke={activePart === 'sleeves' ? highlightColor : '#94a3b8'}
              strokeWidth={activePart === 'sleeves' ? "3" : "0.5"}
              strokeDasharray={activePart === 'sleeves' ? "none" : "4,2"}
            />
            {/* Right Sleeve */}
            <path
              d="M330,180 L390,480 L340,500 L310,210 Z"
              fill={activePart === 'sleeves' ? `${highlightColor}33` : 'transparent'}
              stroke={activePart === 'sleeves' ? highlightColor : '#94a3b8'}
              strokeWidth={activePart === 'sleeves' ? "3" : "0.5"}
              strokeDasharray={activePart === 'sleeves' ? "none" : "4,2"}
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
              if (val === 0) return null;
              
              let coords = { x: 0, y: 0 };
              switch(key) {
                case 'collar': coords = { x: 200, y: 90 }; break;
                case 'shoulders': coords = { x: 200, y: 145 }; break;
                case 'chest': coords = { x: 200, y: 270 }; break;
                case 'sleeves': coords = { x: 50, y: 350 }; break;
                case 'length': coords = { x: 240, y: 500 }; break;
                case 'bottomWidth': coords = { x: 200, y: 780 }; break;
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
        <div className="pb-4 border-b border-border">
          <h2 className="text-xl font-black text-content">مُحدد المقاسات البصري</h2>
          <p className="text-sm text-content-muted font-bold">أدخل المقاسات بدقة للمراجعة الفورية</p>
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
              <label className="block text-[10px] font-black text-content-muted uppercase tracking-widest mb-2">
                {PART_LABELS[part]}
              </label>
              <div className="flex items-center gap-3">
                <input
                  ref={(el) => { inputRefs.current[part] = el; }}
                  type="number"
                  min="0"
                  step="0.1"
                  value={values[part] || ''}
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
