import React from 'react';

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

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hoursStr = String(hours).padStart(2, '0');
  const timeStr = `${hoursStr}:${minutes} ${ampm}`;

  const sizeClasses = {
    xs: 'text-[10px]',
    sm: 'text-xs',
    md: 'text-sm'
  }[size];

  return (
    <span className={`font-mono inline-flex ${inline ? 'items-center gap-1.5' : 'flex-col sm:flex-row sm:items-center gap-1 sm:gap-1.5'} whitespace-nowrap ${sizeClasses} ${className}`} dir="ltr">
      <span className="font-semibold text-content">{dateStr}</span>
      {showTime && (
        <span className="text-[10px] text-content-muted font-medium bg-surface-muted/80 px-1.5 py-0.5 rounded border border-border/50">
          {timeStr}
        </span>
      )}
    </span>
  );
}

export default DateTimeDisplay;
