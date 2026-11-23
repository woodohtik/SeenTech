import React from 'react';
import { cn } from '../../lib/utils';

export interface AutoGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The narrowest a cell may be, in px. 220 for action cards, 200 for number
   * cards (seen-responsive-layout-task.md Phase 2). The grid fits as many
   * columns of at least this width as its own width allows.
   */
  min?: number;
  /** Never more columns than this (four number cards stay 4 + 4, not 7 + 1). */
  maxColumns?: number;
}

/**
 * A grid with no breakpoints: the number of columns follows the grid's own
 * width, wherever it sits -- a wide page, a page beside the assistant, a phone.
 *   grid-template-columns: repeat(auto-fill, minmax(min, 1fr))
 * With min = 220: four columns on 960px, two on 520px, one on a phone.
 * `min(…, 100%)` keeps a single cell from overflowing a container narrower
 * than `min`.
 * Spec: docs/responsive/specs/auto-grid.md
 */
export function AutoGrid({ min = 220, maxColumns, className, style, children, ...rest }: AutoGridProps) {
  // With a cap: a cell is at least 1/maxColumns of the row (less the gaps), so a fifth never fits.
  const floor = maxColumns
    ? `max(${min}px, calc((100% - ${maxColumns - 1} * var(--auto-grid-gap, 1rem)) / ${maxColumns}))`
    : `${min}px`;
  return (
    <div
      className={cn('grid gap-[var(--auto-grid-gap,1rem)]', className)}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${floor}, 100%), 1fr))`, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

export default AutoGrid;
