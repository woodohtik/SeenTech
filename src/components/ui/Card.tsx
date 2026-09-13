import React from 'react';
import { cn } from '../../lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverLift?: boolean;
}

// A single shared surface for the card-shaped blocks scattered across the
// dashboard (stat tiles, list rows, panels) — reduces the surface-area/
// border-radius decisions that were previously repeated ad hoc per component
// (seen-design-professionalization-task.md Phase 1 #3).
export function Card({ hoverLift = false, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'bg-surface border border-border rounded-2xl p-4',
        hoverLift && 'transition-transform duration-200 hover:-translate-y-0.5',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
