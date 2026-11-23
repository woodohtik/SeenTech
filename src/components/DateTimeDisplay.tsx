import React from 'react';
import { localeOf } from '../lib/direction';

interface DateTimeDisplayProps {
  date: string | Date | number | null | undefined;
  className?: string;
  showTime?: boolean;
  inline?: boolean;
  size?: 'xs' | 'sm' | 'md';
}

export function DateTimeDisplay({ 
  date, 
  className = '', 
  showTime = true, 
  inline = false,
  size = 'sm'
}: DateTimeDisplayProps) {
  if (!date) return <span className="text-content-muted">-</span>;
  const d = new Date(date);
  if (isNaN(d.getTime())) return <span className="text-content-muted">-</span>;

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const dateStr = `${day}/${month}/${year}`;

  // P4 (UX-15): the time in the interface's language (ص/م in Arabic), not a
  // fixed English AM/PM.
  const timeStr = d.toLocaleTimeString(localeOf(), { hour: '2-digit', minute: '2-digit', hour12: true });

  const sizeClasses = {
    xs: 'text-sm',
    sm: 'text-sm',
    md: 'text-sm'
  }[size];

  return (
    <span className={`font-mono inline-flex ${inline ? 'items-center gap-1.5' : 'flex-col main-640:flex-row main-640:items-center gap-1 main-640:gap-1.5'} whitespace-nowrap ${sizeClasses} ${className}`} dir="ltr">
      <span className="font-semibold text-content">{dateStr}</span>
      {showTime && (
        <span className="text-sm text-content-muted font-medium bg-surface-muted/80 px-1.5 py-0.5 rounded border border-border/50">
          {timeStr}
        </span>
      )}
    </span>
  );
}

export default DateTimeDisplay;
