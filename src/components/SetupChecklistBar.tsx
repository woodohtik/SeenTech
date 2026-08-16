import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  Store,
  Package,
  UserPlus,
  Scissors,
  Monitor,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Sparkles,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { TOUR_CHECKLIST } from '../config/tourSteps';
import { useSetupChecklist } from '../hooks/useSetupChecklist';
import { isRtlLang } from '../lib/direction';

const ICONS: Record<string, React.ElementType> = {
  Store,
  Package,
  UserPlus,
  Scissors,
  Monitor,
};

interface SetupChecklistBarProps {
  tenantId?: string | null;
  hasPermission: (key: string) => boolean;
}

/**
 * Persistent reminder of the post-onboarding "quick start" checklist. Rendered
 * in normal page flow (not as a floating overlay) at the top of the main
 * content column, so leaving the one-time TourFinishModal without finishing
 * the steps doesn't lose the task entirely. Not dismissible on purpose — it
 * only disappears once every step is actually done.
 */
export default function SetupChecklistBar({ tenantId, hasPermission }: SetupChecklistBarProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isRtl = isRtlLang(i18n.language);
  const Chevron = isRtl ? ChevronLeft : ChevronRight;

  const checklist = React.useMemo(
    () => TOUR_CHECKLIST.filter((item) => !item.permission || hasPermission(item.permission)),
    [hasPermission]
  );

  const { visibleItems, activeItem, completedCount, totalCount, isComplete, loading } = useSetupChecklist(
    tenantId,
    checklist
  );

  const [expanded, setExpanded] = React.useState(false);

  if (loading || isComplete || !tenantId || totalCount === 0) return null;

  const progressPercentage = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="bg-surface border-b border-border shrink-0" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="w-8 h-8 shrink-0 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
          <Sparkles size={16} />
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 flex items-center gap-3 text-start cursor-pointer"
        >
          <span className="text-xs sm:text-sm font-black text-content truncate">
            {t('setup_bar.title')}
          </span>
          <span className="hidden sm:inline text-[11px] font-bold text-content-muted shrink-0">
            {t('tour.finish.progress_count', { completed: completedCount, total: totalCount })}
          </span>
          <div className="hidden sm:block h-1.5 w-24 bg-surface-muted rounded-full overflow-hidden border border-border/40 shrink-0">
            <div
              className="h-full bg-brand rounded-full transition-all duration-500"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <ChevronDown
            size={16}
            className={cn('shrink-0 text-content-muted transition-transform', expanded && 'rotate-180')}
          />
        </button>

        {activeItem && (
          <button
            onClick={() => navigate(activeItem.route)}
            className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-black bg-brand text-white hover:bg-brand/90 transition-colors flex items-center gap-1.5"
          >
            {t('setup_bar.cta')}
            <Chevron size={13} />
          </button>
        )}
      </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-border/60"
            >
              <div className="px-4 py-3 flex flex-wrap gap-2">
                {visibleItems.map((item) => {
                  const Icon = ICONS[item.icon] || Check;
                  const isActive = item.id === activeItem?.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => navigate(item.route)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors',
                        item.completed
                          ? 'bg-emerald-500/[0.03] border-emerald-500/20 text-emerald-700 line-through opacity-80'
                          : isActive
                          ? 'bg-brand/5 border-brand/40 text-brand'
                          : 'bg-surface border-border text-content-muted hover:border-brand/30'
                      )}
                    >
                      {item.completed ? <Check size={13} /> : <Icon size={13} />}
                      {t(`tour.finish.checklist.${item.id}.title`, item.id)}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
    </div>
  );
}
