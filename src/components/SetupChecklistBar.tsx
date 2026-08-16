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
  PartyPopper,
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

  const { completion, visibleItems, activeItem, completedCount, totalCount, isComplete, loading } = useSetupChecklist(
    tenantId,
    checklist
  );

  const [expanded, setExpanded] = React.useState(false);

  // Celebrate a step completing wherever the user happens to be in the app —
  // detected as a false->true transition, not just "is done", so it fires
  // once per completion instead of on every render/page load.
  const [justCompleted, setJustCompleted] = React.useState<typeof checklist[number] | null>(null);
  const prevCompletionRef = React.useRef<typeof completion | null>(null);
  const hasLoadedOnceRef = React.useRef(false);

  React.useEffect(() => {
    if (loading) return;
    if (!hasLoadedOnceRef.current) {
      // Baseline from the first successful fetch — nothing to celebrate yet.
      hasLoadedOnceRef.current = true;
      prevCompletionRef.current = completion;
      return;
    }
    const prev = prevCompletionRef.current;
    prevCompletionRef.current = completion;
    if (!prev) return;
    const newlyDone = checklist.find(
      (item) => !prev[item.id as keyof typeof completion] && completion[item.id as keyof typeof completion]
    );
    if (newlyDone) setJustCompleted(newlyDone);
  }, [completion, loading, checklist]);

  const showBar = !loading && !isComplete && !!tenantId && totalCount > 0;
  const progressPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <>
      {showBar && (
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
      )}

      <AnimatePresence>
        {justCompleted && (
          <div
            className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 16 }}
              className="w-full max-w-sm bg-surface rounded-3xl border border-border shadow-2xl p-7 text-center"
            >
              <div className="w-16 h-16 mx-auto rounded-2xl bg-brand/10 text-brand flex items-center justify-center mb-4">
                <PartyPopper size={30} />
              </div>
              <h3 className="text-lg font-black text-content mb-1.5">
                {t('setup_bar.step_done_title')}
              </h3>
              <p className="text-sm text-content-muted font-medium mb-6">
                {t(`tour.finish.checklist.${justCompleted.id}.title`, justCompleted.id)}
              </p>
              <div className="flex flex-col gap-2">
                {activeItem ? (
                  <button
                    onClick={() => {
                      setJustCompleted(null);
                      navigate(activeItem.route);
                    }}
                    className="w-full px-5 py-3 rounded-2xl font-black text-sm bg-brand text-white hover:bg-brand/90 shadow-lg shadow-brand/20 transition-all active:scale-[0.98]"
                  >
                    {t('setup_bar.next_step')}
                  </button>
                ) : (
                  <button
                    onClick={() => setJustCompleted(null)}
                    className="w-full px-5 py-3 rounded-2xl font-black text-sm bg-brand text-white hover:bg-brand/90 shadow-lg shadow-brand/20 transition-all active:scale-[0.98]"
                  >
                    {t('setup_bar.all_done')}
                  </button>
                )}
                {activeItem && (
                  <button
                    onClick={() => setJustCompleted(null)}
                    className="w-full px-5 py-2.5 rounded-2xl font-bold text-xs text-content-muted hover:bg-surface-muted transition-colors"
                  >
                    {t('setup_bar.later')}
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
