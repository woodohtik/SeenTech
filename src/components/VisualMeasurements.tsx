import React from 'react';
import { 
  Check,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useDirection } from '../lib/direction';

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
  { id: 'classic', labelKey: 'customers.visual_classic', icon: () => <div className="w-8 h-4 border-2 border-current rounded-t-lg" /> },
  { id: 'mandarin', labelKey: 'customers.visual_mandarin', icon: () => <div className="w-8 h-2 border-2 border-current rounded-t-sm" /> },
];

const CUFF_TYPES = [
  { id: 'square', labelKey: 'customers.visual_square', icon: () => <div className="w-6 h-6 border-2 border-current" /> },
  { id: 'round', labelKey: 'customers.visual_round', icon: () => <div className="w-6 h-6 border-2 border-current rounded-full" /> },
];

const POCKET_TYPES = [
  { id: 'hidden', labelKey: 'inventory.pocket_hidden', icon: () => <div className="w-6 h-6 border-2 border-dashed border-current" /> },
  { id: 'visible', labelKey: 'inventory.status_visible', icon: () => <div className="w-6 h-6 border-2 border-current rounded-b-lg" /> },
];

const CHEST_STYLES = [
  { id: 'plain', labelKey: 'inventory.chest_plain', icon: () => <div className="w-8 h-8 border-2 border-current" /> },
  { id: 'pleated', labelKey: 'customers.visual_pleated', icon: () => <div className="w-8 h-8 border-2 border-current flex gap-1 px-1 justify-center"><div className="w-px h-full bg-current"/><div className="w-px h-full bg-current"/></div> },
];

const SHOULDER_STYLES = [
  { id: 'plain', labelKey: 'inventory.chest_plain', icon: () => <div className="w-8 h-8 border-2 border-current" /> },
  { id: 'padded', labelKey: 'customers.visual_padded', icon: () => <div className="w-8 h-8 border-2 border-current flex items-center justify-center"><div className="w-6 h-2 bg-current opacity-20"/></div> },
  { id: 'double', labelKey: 'customers.visual_double', icon: () => <div className="w-8 h-8 border-2 border-current flex flex-col gap-1 p-1 justify-center"><div className="h-px w-full bg-current"/><div className="h-px w-full bg-current"/></div> },
];

export default function VisualMeasurements({ values, onChange, readOnly }: VisualMeasurementsProps) {
  const { t, dir } = useDirection();
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
              type="button"
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
              <span className="text-xs font-bold">{t(opt.labelKey)}</span>
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
    <div className="space-y-6 md:space-y-8 p-4 md:p-6 bg-surface rounded-2xl md:rounded-[2rem] border border-border shadow-sm" dir={dir}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Section title={t('inventory.collar_type')} field="collarType" options={COLLAR_TYPES} />
        <Section title={t('inventory.cuff_type')} field="cuffType" options={CUFF_TYPES} />
        <Section title={t('inventory.pocket_type')} field="pocketType" options={POCKET_TYPES} />
        <Section title={t('measurements.chest_design')} field="chestStyle" options={CHEST_STYLES} />
        <Section title={t('measurements.shoulder_design')} field="shoulderStyle" options={SHOULDER_STYLES} />
      </div>

      <div className="pt-6 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Closure Type */}
        <div className="space-y-4">
          <h3 className="text-sm font-black text-content flex items-center gap-2">
            <div className="w-1.5 h-4 bg-brand rounded-full" />
            {t('measurements.closure_type')}
          </h3>
          <div className="flex gap-3">
            {[
              { id: 'buttons', labelKey: 'inventory.button' },
              { id: 'zipper', labelKey: 'measurements.zipper' }
            ].map((opt) => (
              <button
                type="button"
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
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Closure Visibility */}
        <div className="space-y-4">
          <h3 className="text-sm font-black text-content flex items-center gap-2">
            <div className="w-1.5 h-4 bg-brand rounded-full" />
            {t('measurements.closure_visibility')}
          </h3>
          <div className="flex gap-3">
            {[
              { id: 'visible', labelKey: 'inventory.status_visible' },
              { id: 'hidden', labelKey: 'inventory.pocket_hidden' }
            ].map((opt) => (
              <button
                type="button"
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
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
