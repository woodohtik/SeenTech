import React from 'react';
import { useTranslation } from 'react-i18next';
import { DatePicker, todayYmd } from '../ui/DatePicker';

/**
 * A women's tailoring order's occasion (seen-open-verticals-task.md, wave 1,
 * item 3): the date of the wedding / Eid / graduation the dress is for, and
 * «مستعجل». The list can then put the nearest occasion first.
 */
export function OccasionFields({ occasionDate, isUrgent, onChange }: {
  occasionDate: string;
  isUrgent: boolean;
  onChange: (next: { occasionDate?: string; isUrgent?: boolean }) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 main-720:grid-cols-3 gap-4" data-testid="occasion-fields">
      <div className="space-y-2">
        <div className="flex items-center h-6">
          <label htmlFor="order-occasion-date" className="text-base font-bold text-content leading-6">{t('orders.occasion_date')}</label>
        </div>
        <DatePicker id="order-occasion-date" value={occasionDate} onChange={(v) => onChange({ occasionDate: v })} minDate={todayYmd()} placeholder={t('orders.occasion_date_placeholder')} />
      </div>
      <div className="space-y-2">
        <div className="flex items-center h-6"><span className="text-base font-bold text-content leading-6">{t('orders.urgent')}</span></div>
        <label className="flex items-center gap-3 h-12 px-4 rounded-[var(--radius-md)] border border-border bg-surface cursor-pointer">
          <input type="checkbox" checked={isUrgent} onChange={(e) => onChange({ isUrgent: e.target.checked })} className="w-5 h-5 accent-brand" />
          <span className="text-sm font-bold text-content">{t('orders.urgent_label')}</span>
        </label>
      </div>
    </div>
  );
}
