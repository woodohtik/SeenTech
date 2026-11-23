import React from 'react';
import { cn } from '../../lib/utils';

export interface ResponsiveTableProps {
  /** Full <table>...</table> markup. */
  table: React.ReactNode;
  /**
   * One card per row, for the lists people work through every day (orders,
   * customers, stock): shown where the content is too narrow for the table.
   * Leave it out for a financial report: the table then stays a table and
   * scrolls sideways inside its card, with its first column held in place.
   */
  cards?: React.ReactNode;
  /**
   * Where cards give way to the table -- a width of the CONTENT area, not of
   * the window: sm = 640px, md = 720px, lg = 900px (the default; a dense
   * table needs it, so a tablet upright and a page beside the assistant get
   * cards).
   */
  breakpoint?: 'sm' | 'md' | 'lg';
  /** The name read out for the scrolling region (scroll mode). */
  label?: string;
  className?: string;
}

// Written out in full: Tailwind reads class names from the source as text.
const CARDS = { sm: 'main-640:hidden', md: 'main-720:hidden', lg: 'main-900:hidden' } as const;
const TABLE = { sm: 'hidden main-640:block', md: 'hidden main-720:block', lg: 'hidden main-900:block' } as const;

/**
 * seen-responsive-layout-task.md Phase 2 (and seen-tablet-mobile-ux-review.md
 * item 22, where this component began).
 *
 * The switch used to follow the window (`lg:`), so a 1280px window with the
 * assistant beside the page showed a ten-column table in 584px. It now
 * follows the content's own width (the `main-*` variants, index.css).
 *
 * In both modes numbers are tabular and the table scrolls sideways inside
 * its own box, never the page. In scroll mode the box can be reached and
 * scrolled from the keyboard.
 * Spec: docs/responsive/specs/responsive-table.md
 */
export function ResponsiveTable({ table, cards, breakpoint = 'lg', label, className }: ResponsiveTableProps) {
  if (!cards) {
    return (
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className={cn(
          'max-w-full overflow-x-auto whitespace-nowrap tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          // The first column stays while the rest scrolls under it.
          '[&_td:first-child]:sticky [&_td:first-child]:start-0 [&_td:first-child]:z-[1] [&_td:first-child]:bg-surface',
          '[&_th:first-child]:sticky [&_th:first-child]:start-0 [&_th:first-child]:z-[2] [&_th:first-child]:bg-surface-muted',
          className,
        )}
      >
        {table}
      </div>
    );
  }

  return (
    <div className={cn('min-w-0', className)}>
      <div className={cn(CARDS[breakpoint], 'divide-y divide-border tabular-nums')}>{cards}</div>
      <div className={cn(TABLE[breakpoint], 'overflow-x-auto whitespace-nowrap tabular-nums')}>{table}</div>
    </div>
  );
}
