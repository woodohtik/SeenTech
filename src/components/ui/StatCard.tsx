import React from 'react';
import { cn } from '../../lib/utils';

export interface StatCardProps {
  /** What the number is. Up to two lines, then "…". */
  label: string;
  /** The number itself (a string, or <PriceDisplay/>). Never wraps. */
  value: React.ReactNode;
  /**
   * For a short phrase rather than a number ("5 طلب قيد التنفيذ"): it may
   * wrap, between words only, balanced over its lines.
   */
  wrapValue?: boolean;
  /** The tile at the top: an icon on its colour. */
  icon?: React.ReactNode;
  /** A short status at the top's other end ("نشط", "-66.7%"). */
  badge?: React.ReactNode;
  /** A line under the number: the comparison, the unit. */
  footer?: React.ReactNode;
  /** With onClick the card is a button. */
  onClick?: () => void;
  className?: string;
  id?: string;
}

/**
 * seen-responsive-layout-task.md Phase 2: one card for a number and for an
 * action, in place of the dashboard's hand-built ones.
 *
 * What made the old cards break in a narrow column, and what this one does:
 *   - the label was 12px, uppercase and letter-spaced: now 16px, as written,
 *     two lines at most;
 *   - the number had a fixed size and pushed out of the card: now its size
 *     follows the CARD's width (22px to 28px), it never wraps, and the riyal
 *     sign stays with it;
 *   - nothing inside could shrink: now every row is `min-w-0`.
 * The card is its own CSS container, so the same card is right in a
 * four-column row and in a one-column list.
 * Look (DESIGN.md §4, §5, §7): white, 1px border, 12px corners, no shadow.
 * Spec: docs/responsive/specs/stat-card.md
 */
export function StatCard({ label, value, wrapValue, icon, badge, footer, onClick, className, id }: StatCardProps) {
  const body = (
    <>
      {(icon || badge) && (
        <div className="mb-4 flex w-full min-w-0 items-start justify-between gap-2">
          {icon ? <span className="shrink-0">{icon}</span> : <span />}
          {badge ? <span className="min-w-0 shrink">{badge}</span> : null}
        </div>
      )}
      <div className="mt-auto w-full min-w-0">
        <p className="m-0 line-clamp-2 text-base font-medium leading-[1.5] text-content-muted">{label}</p>
        <p className={cn(
          'm-0 mt-1 font-heading text-[clamp(1.375rem,11cqi,1.75rem)] font-bold leading-[1.25] text-content tabular-nums',
          wrapValue ? 'text-balance [overflow-wrap:normal] [word-break:keep-all]' : 'whitespace-nowrap',
        )}>
          {value}
        </p>
        {footer ? <div className="mt-3 min-w-0 border-t border-border pt-3 text-sm leading-[1.5] text-content-muted">{footer}</div> : null}
      </div>
    </>
  );

  const shell = cn(
    '@container flex h-full w-full min-w-0 flex-col rounded-[12px] border border-border bg-surface p-4 text-start',
    onClick && 'cursor-pointer transition-colors duration-200 hover:border-content-muted/60 hover:bg-surface-muted/40 motion-reduce:transition-none',
    className,
  );

  return onClick
    ? <button type="button" id={id} onClick={onClick} className={shell}>{body}</button>
    : <div id={id} className={shell}>{body}</div>;
}

/** The coloured tile an icon sits on (48px; the icon inside is 24px). */
export function StatIcon({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className={cn('flex h-12 w-12 items-center justify-center rounded-[12px] text-white', className)}>
      {children}
    </span>
  );
}

/** A small status on a card: 14px, 6px corners (DESIGN.md §4: badges). */
export function StatBadge({ tone = 'neutral', children }: { tone?: 'success' | 'danger' | 'neutral' | 'info'; children: React.ReactNode }) {
  const tones = {
    success: 'bg-success/10 text-success',
    danger: 'bg-danger/10 text-danger',
    info: 'bg-info/10 text-info',
    neutral: 'bg-surface-muted text-content-muted',
  } as const;
  return (
    <span className={cn('inline-flex max-w-full items-center whitespace-nowrap rounded-[6px] px-2 py-0.5 text-sm font-bold', tones[tone])}>
      {children}
    </span>
  );
}

export default StatCard;
