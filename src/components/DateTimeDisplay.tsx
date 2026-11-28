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

  // seen-ui-responsive-alignment-audit-task.md (phase 3, orders): the time is
  // plain text -- not a box that looked like a disabled field -- in the
  // interface's font (ص/م were set in a monospace), each part in a <bdi> so
  // «03:56 ص» keeps its order next to the date.
  return (
    <span className={`inline-flex ${inline ? 'items-center gap-1.5' : 'flex-wrap items-center gap-x-1.5'} tabular-nums whitespace-nowrap ${sizeClasses} ${className}`}>
      <bdi dir="ltr" className="font-semibold text-content">{dateStr}</bdi>
      {showTime && <bdi className="text-content-muted font-medium">{timeStr}</bdi>}
    </span>
  );
}

export default DateTimeDisplay;
