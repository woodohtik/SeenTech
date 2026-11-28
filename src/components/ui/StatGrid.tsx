import React from 'react';
import { cn } from '../../lib/utils';

/**
 * Number cards (seen-ui-responsive-alignment-audit-task.md, finding 07,
 * question 2's default): two compact columns on a phone -- not one card per
 * row, ~130px each, pushing the list a screen down -- three from 720px of
 * the container, four from 960px. StatCard keeps its label to two lines.
 */
export function StatGrid({ maxColumns = 4, className, children, ...rest }: React.HTMLAttributes<HTMLDivElement> & { maxColumns?: 2 | 3 | 4 }) {
  return (
    <div className="@container w-full">
      <div
        className={cn(
          'grid grid-cols-2 gap-3 @[720px]:gap-4',
          maxColumns >= 3 && '@[720px]:grid-cols-3',
          maxColumns >= 4 && '@[960px]:grid-cols-4',
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    </div>
  );
}
