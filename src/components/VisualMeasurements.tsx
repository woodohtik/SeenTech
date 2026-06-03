import React from 'react';
import { 
  Shirt, 
  Check, 
  Circle, 
  Square, 
  Layers, 
  Maximize2,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import { cn } from '../lib/utils';

interface VisualMeasurementsProps {
  values: {
    collarType?: string;
    cuffType?: string;
    pocketType?: string;
    chestStyle?: string;
    closureType?: 'zipper' | 'buttons';
    closureVisibility?: 'hidden' | 'visible';
  };
  onChange: (field: string, value: any) => void;
  readOnly?: boolean;
}

const COLLAR_TYPES = [
  { id: 'plain', label: 'سادة', icon: Shirt },
  { id: 'formal', label: 'رسمي', icon: Shirt },
  { id: 'flip', label: 'قلاب', icon: Shirt },
  { id: 'saudi', label: 'سعودي', icon: Shirt },
];

const CUFF_TYPES = [
  { id: 'plain', label: 'سادة', icon: Square },
  { id: 'french', label: 'فرنسي', icon: Square },
  { id: 'round', label: 'دائري', icon: Circle },
];

const POCKET_TYPES = [
  { id: 'none', label: 'بدون', icon: Layers },
  { id: 'single', label: 'واحد', icon: Layers },
  { id: 'double', label: 'اثنين', icon: Layers },
];

const CHEST_STYLES = [
  { id: 'plain', label: 'سادة', icon: Maximize2 },
  { id: 'pleated', label: 'كسرات', icon: Maximize2 },
  { id: 'embroidered', label: 'تطريز', icon: Maximize2 },
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
                "flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all group relative overflow-hidden",
                isSelected 
                  ? "border-brand bg-brand/5 text-brand" 
                  : "border-border bg-surface text-content-muted hover:border-brand/30 hover:bg-brand/5"
              )}
            >
              <opt.icon size={24} className={cn("mb-2 transition-transform", isSelected && "scale-110")} />
              <span className="text-xs font-bold">{opt.label}</span>
              {isSelected && (
                <div className="absolute top-1 right-1">
                  <Check size={12} className="text-brand" />
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
                    ? "border-brand bg-brand text-white" 
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
                    ? "border-brand bg-brand text-white" 
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
