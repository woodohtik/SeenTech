import React from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarHeart, Zap } from 'lucide-react';
import { occasionOf, type OccasionLike } from '../../utils/orderOccasion';

/** «مستعجل» and the occasion's date on an order card (seen-open-verticals-task.md, wave 1). */
export function OccasionBadges({ order }: { order: OccasionLike }) {
  const { t } = useTranslation();
  const { date, urgent } = occasionOf(order);
  if (!date && !urgent) return null;
  return (
    <>
      {urgent && (
        <span className="inline-flex items-center gap-1 min-h-6 px-2 rounded-full bg-[var(--seen-danger-bg)] text-danger-strong text-sm font-black">
          <Zap size={12} aria-hidden="true" />{t('orders.urgent_badge')}
        </span>
      )}
      {date && (
        <span className="inline-flex items-center gap-1 min-h-6 px-2 rounded-full bg-brand/10 text-brand text-sm font-bold">
          <CalendarHeart size={12} aria-hidden="true" />{t('orders.occasion_badge', { date: '' })}<bdi dir="ltr">{date}</bdi>
        </span>
      )}
    </>
  );
}
