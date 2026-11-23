import React from 'react';
import { cn } from '../../lib/utils';
import { useDirection } from '../../lib/direction';

export interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  /** A short status beside the title (the subscription's days left). */
  badge?: React.ReactNode;
  /** The shop's logo, or nothing. */
  logo?: React.ReactNode;
  /** The page's tools: filters, actions. They wrap; they never squeeze the title. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * seen-responsive-layout-task.md Phase 2: the title of a page and its tools.
 *
 * It arranges itself by the CONTENT's width (the `main-*` variants), not the
 * window's -- so it is the same header beside an open assistant, beside an
 * open sidebar, and on a phone:
 *   under 720px of content   title, then the tools on their own row
 *   720px and up             title at the start, tools at the end, one row
 * The title is 36px, 28px under 640px of content; it is never broken inside
 * a word. The tools wrap onto more rows before anything is squeezed.
 * Spec: docs/responsive/specs/page-header.md
 */
export function PageHeader({ title, subtitle, badge, logo, children, className }: PageHeaderProps) {
  const { dir } = useDirection();
  return (
    <header
      dir={dir}
      className={cn(
        'mb-8 flex w-full flex-col gap-4 text-start',
        'main-720:flex-row main-720:items-center main-720:justify-between main-720:gap-6',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-4 main-720:max-w-[46%] main-720:shrink-0">
        {logo}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="m-0 text-balance text-[28px] font-black leading-[1.25] text-content [overflow-wrap:normal] [word-break:keep-all] main-640:text-[36px] main-640:leading-[1.2]">
              {title}
            </h2>
            {badge}
          </div>
          {subtitle ? <p className="m-0 mt-1 text-base font-medium leading-[1.6] text-content-muted">{subtitle}</p> : null}
        </div>
      </div>

      {children ? (
        // The tools wrap -- and so does a row of them a screen wraps in its
        // own <div>; a button's label never breaks inside the row.
        <div className="flex min-w-0 flex-wrap items-center gap-3 main-720:flex-1 main-720:justify-end [&>div]:max-w-full [&>div]:flex-wrap [&>button]:whitespace-nowrap [&>div>button]:whitespace-nowrap">
          {children}
        </div>
      ) : null}
    </header>
  );
}

export default PageHeader;
