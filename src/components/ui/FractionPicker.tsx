import React from 'react';
import { cn } from '../../lib/utils';

const FRACTIONS: { label: string; value: number }[] = [
  { label: '٠', value: 0 },
  { label: '¼', value: 0.25 },
  { label: '½', value: 0.5 },
  { label: '¾', value: 0.75 },
];

interface FractionPickerProps {
  /** Current measurement value in display units (whole + fractional part). */
  value: number;
  /** Called with the whole part plus the selected fraction. */
  onSelect: (newValue: number) => void;
  className?: string;
}

/**
 * Quick-pick buttons for the quarter-inch/cm fractions a tailor actually
 * measures and speaks in, so they don't have to mentally convert "half" to
 * "0.5" and type it. Selecting a fraction replaces only the decimal part of
 * the current value -- the whole part typed into the number field is left
 * untouched.
 */
export function FractionPicker({ value, onSelect, className }: FractionPickerProps) {
  const safeValue = value || 0;
  const whole = Math.floor(safeValue);
  const currentFraction = Math.round((safeValue - whole) * 4) / 4;

  return (
    <div className={cn('flex gap-1.5', className)}>
      {FRACTIONS.map((fraction) => {
        const isActive = currentFraction === fraction.value;
        return (
          <button
            key={fraction.label}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(whole + fraction.value)}
            className={cn(
              'w-8 h-8 rounded-lg text-sm font-bold transition-all cursor-pointer border',
              isActive
                ? 'bg-brand text-white border-brand shadow-sm'
                : 'bg-surface-muted text-content-muted border-border hover:border-brand/40 hover:text-brand'
            )}
          >
            {fraction.label}
          </button>
        );
      })}
    </div>
  );
}
