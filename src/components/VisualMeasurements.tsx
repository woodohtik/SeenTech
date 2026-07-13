import React from 'react';
import { 
  Check,
} from 'lucide-react';
import { cn } from '../lib/utils';

interface VisualMeasurementsProps {
  values: {
    collarType?: string;
    cuffType?: string;
    pocketType?: string;
    chestStyle?: string;
    shoulderStyle?: string;
    closureType?: 'zipper' | 'buttons';
    closureVisibility?: 'hidden' | 'visible';
  };
  onChange: (field: string, value: any) => void;
  readOnly?: boolean;
}

const COLLAR_TYPES = [
  { id: 'classic', label: 'كلاسيك', icon: () => <div className="w-8 h-4 border-2 border-current rounded-t-lg" /> },
  { id: 'mandarin', label: 'صيني', icon: () => <div className="w-8 h-2 border-2 border-current rounded-t-sm" /> },
];

const CUFF_TYPES = [
  { id: 'square', label: 'مربع', icon: () => <div className="w-6 h-6 border-2 border-current" /> },
  { id: 'round', label: 'دائري', icon: () => <div className="w-6 h-6 border-2 border-current rounded-full" /> },
];

const POCKET_TYPES = [
  { id: 'hidden', label: 'مخفي', icon: () => <div className="w-6 h-6 border-2 border-dashed border-current" /> },
  { id: 'visible', label: 'ظاهر', icon: () => <div className="w-6 h-6 border-2 border-current rounded-b-lg" /> },
];

const CHEST_STYLES = [
  { id: 'plain', label: 'سادة', icon: () => <div className="w-8 h-8 border-2 border-current" /> },
  { id: 'pleated', label: 'كسرات', icon: () => <div className="w-8 h-8 border-2 border-current flex gap-1 px-1 justify-center"><div className="w-px h-full bg-current"/><div className="w-px h-full bg-current"/></div> },
];

const SHOULDER_STYLES = [
  { id: 'plain', label: 'سادة', icon: () => <div className="w-8 h-8 border-2 border-current" /> },
  { id: 'padded', label: 'حشوة', icon: () => <div className="w-8 h-8 border-2 border-current flex items-center justify-center"><div className="w-6 h-2 bg-current opacity-20"/></div> },
  { id: 'double', label: 'دبل', icon: () => <div className="w-8 h-8 border-2 border-current flex flex-col gap-1 p-1 justify-center"><div className="h-px w-full bg-current"/><div className="h-px w-full bg-current"/></div> },
];

export default function VisualMeasurements({ values, onChange, readOnly }: VisualMeasurementsProps) {
  const Section = ({ title, field, options }: { title: string, field: string, options: any[] }) => (
    <div className="space-y-4">
      <h3 className="text-sm font-black text-content flex items-center gap-2">
        <div className="w-1.5 h-4 bg-brand rounded-full" />
        {title}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {options.map((opt) => {
          const isSelected = values[field as keyof typeof values] === opt.id;
          return (
            <button
              key={opt.id}
              disabled={readOnly}
              onClick={() => onChange(field, opt.id)}
              className={cn(
                "flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all group relative overflow-hidden h-24",
                isSelected 
                  ? "border-brand bg-brand/5 text-brand shadow-sm shadow-brand/10" 
                  : "border-border bg-surface text-content-muted hover:border-brand/30 hover:bg-brand/5"
              )}
            >
              <div className={cn("mb-3 flex items-center justify-center transition-transform", isSelected && "scale-110 text-brand")}>
                <opt.icon />
              </div>
              <span className="text-xs font-bold">{opt.label}</span>
              {isSelected && (
                <div className="absolute top-2 right-2">
                  <Check size={14} className="text-brand" strokeWidth={3} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 md:space-y-8 p-4 md:p-6 bg-surface rounded-2xl md:rounded-[2rem] border border-border shadow-sm" dir="rtl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Section title="نوع الياقة" field="collarType" options={COLLAR_TYPES} />
        <Section title="نوع الكبك" field="cuffType" options={CUFF_TYPES} />
        <Section title="نوع الجيب" field="pocketType" options={POCKET_TYPES} />
        <Section title="تصميم الصدر" field="chestStyle" options={CHEST_STYLES} />
        <Section title="تصميم الكتف" field="shoulderStyle" options={SHOULDER_STYLES} />
      </div>

      <div className="pt-6 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Closure Type */}
        <div className="space-y-4">
          <h3 className="text-sm font-black text-content flex items-center gap-2">
            <div className="w-1.5 h-4 bg-brand rounded-full" />
            نوع الإغلاق
          </h3>
          <div className="flex gap-3">
            {[
              { id: 'buttons', label: 'أزرار' },
              { id: 'zipper', label: 'سحاب' }
            ].map((opt) => (
              <button
                key={opt.id}
                disabled={readOnly}
                onClick={() => onChange('closureType', opt.id)}
                className={cn(
                  "flex-1 py-3 rounded-xl border-2 font-bold text-sm transition-all",
                  values.closureType === opt.id 
                    ? "border-brand bg-brand text-white shadow-md shadow-brand/20" 
                    : "border-border bg-surface text-content-muted hover:border-brand/30"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Closure Visibility */}
        <div className="space-y-4">
          <h3 className="text-sm font-black text-content flex items-center gap-2">
            <div className="w-1.5 h-4 bg-brand rounded-full" />
            ظهور الإغلاق
          </h3>
          <div className="flex gap-3">
            {[
              { id: 'visible', label: 'ظاهر' },
              { id: 'hidden', label: 'مخفي' }
            ].map((opt) => (
              <button
                key={opt.id}
                disabled={readOnly}
                onClick={() => onChange('closureVisibility', opt.id)}
                className={cn(
                  "flex-1 py-3 rounded-xl border-2 font-bold text-sm transition-all",
                  values.closureVisibility === opt.id 
                    ? "border-brand bg-brand text-white shadow-md shadow-brand/20" 
                    : "border-border bg-surface text-content-muted hover:border-brand/30"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
