import React from 'react';
import { cn } from '../../lib/utils';

export interface FormGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The most columns the form may take: 2 for a short form, 3 (default) for a long one. */
  columns?: 1 | 2 | 3;
}

/**
 * seen-responsive-layout-task.md Phase 2: a form's columns follow the width
 * the FORM has -- one under 640px, two from 640px, three from 960px -- whether
 * it sits on a page, in a window, or in a bottom sheet. So it measures itself
 * (a CSS container on its own wrapper) rather than the page.
 *
 * A field that must span the row: `className="col-span-full"`.
 * Fields and buttons inside are 48px tall (--size-input-height, DESIGN.md §7).
 * Spec: docs/responsive/specs/form-grid.md
 */
export function FormGrid({ columns = 3, className, children, ...rest }: FormGridProps) {
  return (
    <div className="@container w-full">
      <div
        className={cn(
          'grid grid-cols-1 gap-x-4 gap-y-4',
          columns >= 2 && '@[640px]:grid-cols-2',
          columns >= 3 && '@[960px]:grid-cols-3',
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    </div>
  );
}

export default FormGrid;
