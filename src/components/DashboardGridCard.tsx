import React from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from './ui/Icon';
import { StatBadge, StatCard, StatIcon } from './ui/StatCard';

interface DashboardGridCardProps {
  title: string;
  detail: string | React.ReactNode;
  icon: IconName;
  color: string; // Tailwind class for the icon tile's colour
  isActive?: boolean;
  onClick?: () => void;
}

/**
 * The dashboard's action cards ("خياطة وتفصيل: 5 طلب قيد التنفيذ").
 * seen-responsive-layout-task.md Phase 2: built on StatCard, so the label
 * is 16px with no letter-spacing, the line under it wraps between words
 * only, and nothing inside pushes the card wider than its column.
 */
export default function DashboardGridCard({ title, detail, icon, color, isActive = true, onClick }: DashboardGridCardProps) {
  const { t } = useTranslation();
  return (
    <StatCard
      onClick={onClick}
      label={title}
      value={detail}
      wrapValue
      icon={<StatIcon className={color}><Icon name={icon} className="h-6 w-6" /></StatIcon>}
      badge={isActive ? <StatBadge tone="success">{t('saas.status_active')}</StatBadge> : undefined}
    />
  );
}
