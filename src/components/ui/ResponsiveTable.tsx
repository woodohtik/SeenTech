import React from 'react';
import { cn } from '../../lib/utils';

export interface ResponsiveTableProps {
  /** Full <table>...</table> markup, shown at/above the breakpoint. */
  table: React.ReactNode;
  /** Stacked card markup, shown below the breakpoint. */
  cards: React.ReactNode;
  /** Where cards switch to the table. 'lg' matches InventoryManager.tsx
   * (so real tablets in portrait get cards, not a dense desktop table). */
  breakpoint?: 'sm' | 'md' | 'lg';
  className?: string;
}

const HIDDEN_CARDS = { sm: 'sm:hidden', md: 'md:hidden', lg: 'lg:hidden' } as const;
const HIDDEN_TABLE = { sm: 'hidden sm:block', md: 'hidden md:block', lg: 'hidden lg:block' } as const;

/**
 * سِين (seen-tablet-mobile-ux-review.md بند 22): لا يوجد مكوّن جدول مشترك --
 * كل شاشة تكرّر نفس التفريع (بطاقات أسفل نقطة فصل، جدول أعلاها) يدوياً،
 * فبعضها يطبّقه وبعضها ينساه. هذا المكوّن فقط يوحِّد الـwrapper (لا يفرض
 * بنية أعمدة عامة -- كل شاشة لا تزال تؤلّف جدولها/بطاقاتها الخاصة، لأن
 * الأعمدة تختلف جذرياً بين الشاشات) حتى لا يُنسى أحد الفرعين مجدداً.
 */
export function ResponsiveTable({ table, cards, breakpoint = 'lg', className }: ResponsiveTableProps) {
  const hiddenCards = HIDDEN_CARDS[breakpoint];
  const hiddenTable = HIDDEN_TABLE[breakpoint];

  return (
    <div className={className}>
      <div className={cn(hiddenCards, 'divide-y divide-border')}>{cards}</div>
      <div className={cn(hiddenTable, 'overflow-x-auto whitespace-nowrap')}>{table}</div>
    </div>
  );
}
