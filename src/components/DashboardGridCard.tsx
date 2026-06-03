import React from 'react';
import { cn } from '../lib/utils';
import { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DashboardGridCardProps {
  title: string;
  detail: string;
  icon: LucideIcon;
  color: string; // Tailwind class for icon color
  isActive?: boolean;
  onClick?: () => void;
}

export default function DashboardGridCard({
  title,
  detail,
  icon: Icon,
  color,
  isActive = true,
  onClick
}: DashboardGridCardProps) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language !== 'en';
  const dir = isRtl ? 'rtl' : 'ltr';
  const textAlignmentClass = isRtl ? 'text-right' : 'text-left';
  const flexAlignmentClass = isRtl ? 'items-start' : 'items-end';

  return (
    <button
      onClick={onClick}
      className={cn(
        "bg-surface p-6 rounded-3xl border border-border shadow-sm hover:shadow-xl transition-all group flex flex-col w-full cursor-pointer h-full",
        textAlignmentClass,
        flexAlignmentClass
      )}
      dir={dir}
    >
      <div className="flex items-center justify-between mb-4 w-full">
        <div className={cn(color, "p-4 rounded-2xl text-white shadow-lg shadow-current/20 group-hover:scale-110 transition-transform")}>
          <Icon size={24} />
        </div>
        {isActive && (
          <span className="text-[10px] font-black px-2 py-1 rounded-lg bg-success/10 text-success">
            {t('common.active', 'نشط')}
          </span>
        )}
      </div>
      
      <div className={cn("mt-auto w-full", textAlignmentClass)}>
        <p className="text-content-muted text-xs font-black uppercase tracking-widest">{title}</p>
        <h3 className={cn("text-xl font-black text-content mt-1", textAlignmentClass)}>
          {detail}
        </h3>
      </div>
    </button>
  );
}
