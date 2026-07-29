import React from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  PartyPopper,
  Store,
  Package,
  UserPlus,
  Scissors,
  Monitor,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  X as XIcon,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { TourChecklistItem } from '../../config/tourSteps';

const ICONS: Record<string, React.ElementType> = {
  Store,
  Package,
  UserPlus,
  Scissors,
  Monitor,
};

interface TourFinishModalProps {
  checklist: TourChecklistItem[];
  onGo: (route: string) => void;
  onClose: () => void;
  onRestart: () => void;
}

export default function TourFinishModal({ checklist, onGo, onClose, onRestart }: TourFinishModalProps) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';
  const Chevron = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div
      className="seen-tour-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-lg bg-surface rounded-3xl border border-border shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col"
      >
        <button
          onClick={onClose}
          aria-label={t('common.close', 'إغلاق')}
          className={cn(
            'absolute top-4 z-10 p-2 rounded-full text-content-muted hover:text-content hover:bg-surface-muted transition-colors',
            isRtl ? 'left-4' : 'right-4'
          )}
        >
          <XIcon size={18} />
        </button>

        <div className="px-7 pt-9 pb-6 text-center shrink-0">
          <motion.div
            initial={{ scale: 0.5, rotate: -12 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.12, type: 'spring', stiffness: 220, damping: 14 }}
            className="w-[4.5rem] h-[4.5rem] mx-auto rounded-3xl bg-brand/10 text-brand flex items-center justify-center mb-4 border border-brand/15"
          >
            <PartyPopper size={34} />
          </motion.div>

          <h2 className="text-2xl font-black text-content leading-tight">
            {t('tour.finish.title', 'أنت جاهز للانطلاق! 🎉')}
          </h2>
          <p className="text-content-muted text-sm font-medium mt-2 leading-relaxed max-w-sm mx-auto">
            {t(
              'tour.finish.subtitle',
              'أكملت الجولة التعريفية. هذه أول خطوات مقترحة لتجهيز محلك والبدء في العمل فعلياً.'
            )}
          </p>
        </div>

        {/* Quick start checklist */}
        <div className="px-5 sm:px-6 pb-2 space-y-2 overflow-y-auto">
          <p className="px-1.5 pb-1 text-[11px] font-black text-content-muted uppercase tracking-widest">
            {t('tour.finish.checklist_title', 'خطوات البدء السريع')}
          </p>

          {checklist.map((item, idx) => {
            const Icon = ICONS[item.icon] || CheckCircle2;
            return (
              <button
                key={item.id}
                onClick={() => onGo(item.route)}
                className="w-full flex items-center gap-3.5 p-3.5 rounded-2xl bg-surface-muted/40 border border-border/60 hover:border-brand/35 hover:bg-brand/5 transition-all text-start cursor-pointer group"
              >
                <div className="w-9 h-9 shrink-0 rounded-xl bg-surface border border-border flex items-center justify-center text-brand group-hover:bg-brand group-hover:text-white group-hover:border-brand transition-all">
                  <Icon size={17} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-[13px] text-content leading-tight">
                    <span className="text-content-muted/70 me-1.5">{idx + 1}.</span>
                    {t(`tour.finish.checklist.${item.id}.title`, item.id)}
                  </p>
                  <p className="text-[11px] text-content-muted font-medium mt-0.5 leading-relaxed truncate">
                    {t(`tour.finish.checklist.${item.id}.desc`, '')}
                  </p>
                </div>
                <Chevron size={17} className="text-content-muted/50 shrink-0 group-hover:text-brand transition-colors" />
              </button>
            );
          })}
        </div>

        <div className="px-5 sm:px-6 py-5 flex flex-col-reverse sm:flex-row gap-2.5 shrink-0 border-t border-border/60 mt-3">
          <button
            onClick={onRestart}
            className="flex-1 px-5 py-3 rounded-2xl font-bold text-xs sm:text-sm text-content-muted bg-surface-muted hover:bg-border/60 transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <RotateCcw size={15} />
            <span>{t('tour.finish.restart', 'إعادة الجولة')}</span>
          </button>
          <button
            onClick={onClose}
            className="flex-[1.4] px-5 py-3 rounded-2xl font-black text-sm bg-brand text-white hover:bg-brand/90 shadow-lg shadow-brand/25 transition-all active:scale-[0.98] cursor-pointer"
          >
            {t('tour.finish.done', 'ابدأ العمل الآن')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
