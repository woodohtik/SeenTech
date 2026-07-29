import React from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  Monitor,
  Scissors,
  BarChart3,
  Clock,
  ArrowLeft,
  ArrowRight,
  X as XIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface TourWelcomeModalProps {
  tenantName?: string | null;
  userName?: string | null;
  logoUrl?: string | null;
  stepCount: number;
  onStart: () => void;
  onSkip: () => void;
}

export default function TourWelcomeModal({
  tenantName,
  userName,
  logoUrl,
  stepCount,
  onStart,
  onSkip,
}: TourWelcomeModalProps) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';

  const highlights = [
    {
      icon: Monitor,
      title: t('tour.welcome.highlight1_title', 'نقطة بيع سريعة'),
      desc: t('tour.welcome.highlight1_desc', 'فواتير ضريبية متوافقة مع ZATCA في ثوانٍ'),
    },
    {
      icon: Scissors,
      title: t('tour.welcome.highlight2_title', 'متابعة التفصيل'),
      desc: t('tour.welcome.highlight2_desc', 'من القياس إلى التسليم بخطوات واضحة'),
    },
    {
      icon: BarChart3,
      title: t('tour.welcome.highlight3_title', 'تقارير فورية'),
      desc: t('tour.welcome.highlight3_desc', 'أرباحك ومخزونك وأداء فريقك في لوحة واحدة'),
    },
  ];

  const ArrowNext = isRtl ? ArrowLeft : ArrowRight;

  return (
    <div
      className="seen-tour-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-lg bg-surface rounded-3xl border border-border shadow-2xl overflow-hidden"
      >
        {/* Dismiss */}
        <button
          onClick={onSkip}
          aria-label={t('tour.welcome.skip', 'تخطي')}
          className={cn(
            'absolute top-4 z-10 p-2 rounded-full text-white/70 hover:text-white hover:bg-white/15 transition-colors',
            isRtl ? 'left-4' : 'right-4'
          )}
        >
          <XIcon size={18} />
        </button>

        {/* Brand header */}
        <div className="relative px-7 pt-9 pb-8 bg-gradient-to-br from-brand via-brand to-brand/80 text-white overflow-hidden">
          <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-14 -right-6 w-44 h-44 rounded-full bg-white/10 blur-2xl" />

          <div className="relative flex flex-col items-center text-center gap-4">
            <div className="w-20 h-20 rounded-3xl bg-white/15 border border-white/25 backdrop-blur-sm flex items-center justify-center shadow-lg overflow-hidden">
              {logoUrl ? (
                <img src={logoUrl} alt={tenantName || 'Logo'} className="w-full h-full object-cover" />
              ) : (
                <Sparkles size={34} className="text-white" />
              )}
            </div>

            <div className="space-y-1.5">
              <h2 className="text-2xl sm:text-[1.7rem] font-black leading-tight">
                {userName
                  ? t('tour.welcome.title_named', 'مرحباً {{name}} 👋', { name: userName })
                  : t('tour.welcome.title', 'مرحباً بك في نظام سين الذكي 👋')}
              </h2>
              <p className="text-white/85 text-sm font-medium leading-relaxed max-w-sm mx-auto">
                {tenantName
                  ? t(
                      'tour.welcome.subtitle_tenant',
                      'دعنا نأخذك في جولة سريعة داخل {{tenant}} لتتعرف على كل ما يمكنك فعله.',
                      { tenant: tenantName }
                    )
                  : t(
                      'tour.welcome.subtitle',
                      'دعنا نأخذك في جولة سريعة لتتعرف على كل ما يمكنك فعله في النظام.'
                    )}
              </p>
            </div>

            <div className="inline-flex items-center gap-2 bg-white/15 border border-white/20 px-3.5 py-1.5 rounded-full text-[11px] font-bold">
              <Clock size={13} />
              <span>
                {t('tour.welcome.duration', '{{count}} خطوة • أقل من دقيقتين', { count: stepCount })}
              </span>
            </div>
          </div>
        </div>

        {/* Highlights */}
        <div className="px-6 sm:px-7 py-6 space-y-3">
          {highlights.map((h) => (
            <div
              key={h.title}
              className="flex items-start gap-3.5 p-3.5 rounded-2xl bg-surface-muted/50 border border-border/60"
            >
              <div className="w-10 h-10 shrink-0 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
                <h.icon size={20} />
              </div>
              <div className="min-w-0">
                <p className="font-black text-sm text-content leading-tight">{h.title}</p>
                <p className="text-xs text-content-muted font-medium mt-1 leading-relaxed">{h.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="px-6 sm:px-7 pb-7 pt-1 flex flex-col-reverse sm:flex-row gap-2.5">
          <button
            onClick={onSkip}
            className="flex-1 px-5 py-3.5 rounded-2xl font-bold text-sm text-content-muted bg-surface-muted hover:bg-border/60 transition-colors cursor-pointer"
          >
            {t('tour.welcome.skip_full', 'تخطي، سأستكشف بنفسي')}
          </button>
          <button
            onClick={onStart}
            className="flex-[1.4] px-5 py-3.5 rounded-2xl font-black text-sm bg-brand text-white hover:bg-brand/90 shadow-lg shadow-brand/25 transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
          >
            <span>{t('tour.welcome.start', 'ابدأ الجولة التعريفية')}</span>
            <ArrowNext size={17} />
          </button>
        </div>

        <p className="pb-6 -mt-3 text-center text-[11px] text-content-muted/80 font-medium px-6">
          {t('tour.welcome.restart_hint', 'يمكنك إعادة الجولة في أي وقت من قائمة المستخدم أو الإعدادات.')}
        </p>
      </motion.div>
    </div>
  );
}
