import React, { useState, useEffect, useMemo } from 'react';
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
  Check,
  Loader2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { TourChecklistItem } from '../../config/tourSteps';
import { supabase } from '../../lib/supabase/client';

const ICONS: Record<string, React.ElementType> = {
  Store,
  Package,
  UserPlus,
  Scissors,
  Monitor,
};

interface TourFinishModalProps {
  checklist: TourChecklistItem[];
  tenantId?: string | null;
  onGo: (route: string) => void;
  onClose: () => void;
  onRestart: () => void;
}

interface CompletionState {
  shop_profile: boolean;
  add_stock: boolean;
  add_customer: boolean;
  first_order: boolean;
  first_sale: boolean;
}

export default function TourFinishModal({
  checklist,
  tenantId,
  onGo,
  onClose,
  onRestart,
}: TourFinishModalProps) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';
  const Chevron = isRtl ? ChevronLeft : ChevronRight;

  const [completion, setCompletion] = useState<CompletionState>({
    shop_profile: false,
    add_stock: false,
    add_customer: false,
    first_order: false,
    first_sale: false,
  });
  const [loading, setLoading] = useState(true);

  // Fetch actual data completion status from Supabase
  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    async function checkStatuses() {
      try {
        const [
          tenantRes,
          inventoryRes,
          customerRes,
          ordersRes,
          invoicesRes,
        ] = await Promise.all([
          supabase.from('tenants').select('address, phone, vat_number').eq('id', tenantId).maybeSingle(),
          supabase.from('inventory_items').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
          supabase.from('customers').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
          supabase.from('orders').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
          supabase.from('tax_invoices').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        ]);

        const shop_profile = !!(tenantRes.data && (tenantRes.data.address || tenantRes.data.phone || tenantRes.data.vat_number));
        const add_stock = !!(inventoryRes.count && inventoryRes.count > 0);
        const add_customer = !!(customerRes.count && customerRes.count > 0);
        const first_order = !!(ordersRes.count && ordersRes.count > 0);
        const first_sale = !!(invoicesRes.count && invoicesRes.count > 0);

        setCompletion({
          shop_profile,
          add_stock,
          add_customer,
          first_order,
          first_sale,
        });
      } catch (err) {
        console.error('Error fetching quick start completion statuses:', err);
      } finally {
        setLoading(false);
      }
    }

    checkStatuses();
  }, [tenantId]);

  // Determine which steps are visible and their status (unlocked progressively)
  const visibleItems = useMemo(() => {
    const items: (TourChecklistItem & { completed: boolean })[] = [];

    for (let i = 0; i < checklist.length; i++) {
      const item = checklist[i];
      const isCompleted = completion[item.id as keyof CompletionState] || false;

      // Always show the first item (Shop Profile)
      if (i === 0) {
        items.push({ ...item, completed: isCompleted });
      } else {
        // Show subsequent item only if the previous item in the sequence is completed
        const prevItem = checklist[i - 1];
        const isPrevCompleted = completion[prevItem.id as keyof CompletionState] || false;

        if (isPrevCompleted) {
          items.push({ ...item, completed: isCompleted });
        } else {
          // Break at the first incomplete item so no further items are shown
          break;
        }
      }
    }

    return items;
  }, [checklist, completion]);

  // Find the current active (incomplete and unlocked) item
  const activeItemId = useMemo(() => {
    const lastItem = visibleItems[visibleItems.length - 1];
    return lastItem && !lastItem.completed ? lastItem.id : null;
  }, [visibleItems]);

  // Total completed count of ALL items in the checklist
  const completedCount = useMemo(() => {
    return Object.values(completion).filter(Boolean).length;
  }, [completion]);

  const totalCount = checklist.length;
  const progressPercentage = Math.round((completedCount / totalCount) * 100);

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

        <div className="px-7 pt-9 pb-5 text-center shrink-0">
          <motion.div
            initial={{ scale: 0.5, rotate: -12 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.12, type: 'spring', stiffness: 220, damping: 14 }}
            className="w-[4.5rem] h-[4.5rem] mx-auto rounded-3xl bg-brand/10 text-brand flex items-center justify-center mb-4 border border-brand/15"
          >
            <PartyPopper size={34} />
          </motion.div>

          <h2 className="text-2xl font-black text-content leading-tight">
            {completedCount === totalCount
              ? t('tour.finish.complete_all_title', 'تهانينا! تم تدشين متجرك بنجاح 🚀')
              : t('tour.finish.title', 'أنت جاهز للانطلاق! 🎉')}
          </h2>
          <p className="text-content-muted text-xs font-semibold mt-2 leading-relaxed max-w-sm mx-auto">
            {completedCount === totalCount
              ? t('tour.finish.complete_all_desc', 'لقد أكملت جميع خطوات التدشين بنجاح. أنت الآن مستعد لإدارة مبيعاتك ومخزونك بالكامل.')
              : t(
                  'tour.finish.subtitle',
                  'أكملت الجولة التعريفية. هذه أول خطوات مقترحة لتجهيز محلك والبدء في العمل فعلياً.'
                )}
          </p>

          {/* Progress Indicator */}
          <div className="mt-5 max-w-xs mx-auto">
            <div className="flex justify-between text-[11px] font-bold text-content-muted mb-1.5 px-0.5">
              <span>{t('tour.finish.setup_progress', 'خطوات تدشين المتجر')}</span>
              <span>
                {completedCount} {t('common.of', 'من')} {totalCount}
              </span>
            </div>
            <div className="h-2 w-full bg-surface-muted rounded-full overflow-hidden border border-border/40">
              <motion.div
                className="h-full bg-brand rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progressPercentage}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
          </div>
        </div>

        {/* Quick start checklist */}
        <div className="px-5 sm:px-6 pb-2 space-y-2 overflow-y-auto">
          <p className="px-1.5 pb-1 text-[11px] font-black text-content-muted uppercase tracking-widest">
            {t('tour.finish.checklist_title', 'خطوات البدء السريع')}
          </p>

          {loading ? (
            <div className="py-8 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-brand" />
              <span className="text-xs font-bold text-content-muted">
                {t('common.loading', 'جاري تحميل الخطوات...')}
              </span>
            </div>
          ) : (
            visibleItems.map((item, idx) => {
              const Icon = ICONS[item.icon] || CheckCircle2;
              const isCompleted = item.completed;
              const isActive = item.id === activeItemId;

              return (
                <motion.button
                  key={item.id}
                  onClick={() => onGo(item.route)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.08 }}
                  className={cn(
                    'w-full flex items-center gap-3.5 p-3.5 rounded-2xl border transition-all text-start cursor-pointer group relative overflow-hidden',
                    isCompleted
                      ? 'bg-emerald-500/[0.02] border-emerald-500/20 hover:border-emerald-500/40 hover:bg-emerald-500/[0.04]'
                      : isActive
                      ? 'bg-brand/5 border-brand/40 shadow-md shadow-brand/5 ring-2 ring-brand/10'
                      : 'bg-surface border-border hover:border-brand/30 hover:bg-surface-muted/50'
                  )}
                >
                  {/* Status Indicator background line for active item */}
                  {isActive && (
                    <div className="absolute top-0 bottom-0 start-0 w-1 bg-brand" />
                  )}

                  {/* Icon section */}
                  <div
                    className={cn(
                      'w-9 h-9 shrink-0 rounded-xl border flex items-center justify-center transition-all',
                      isCompleted
                        ? 'bg-emerald-50 border-emerald-100 text-emerald-600'
                        : isActive
                        ? 'bg-brand text-white border-brand shadow-sm animate-pulse-subtle'
                        : 'bg-surface border-border text-content-muted group-hover:bg-brand group-hover:text-white group-hover:border-brand'
                    )}
                  >
                    {isCompleted ? <Check size={16} strokeWidth={3} /> : <Icon size={17} />}
                  </div>

                  {/* Content section */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p
                        className={cn(
                          'font-black text-[13px] leading-tight',
                          isCompleted ? 'text-content-muted line-through opacity-80' : 'text-content'
                        )}
                      >
                        <span className="text-content-muted/70 me-1.5">{idx + 1}.</span>
                        {t(`tour.finish.checklist.${item.id}.title`, item.id)}
                      </p>

                      {isCompleted && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase tracking-wider">
                          {t('common.completed', 'مكتمل')}
                        </span>
                      )}

                      {isActive && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-black bg-brand text-white uppercase tracking-wider animate-pulse">
                          {t('common.next_step', 'الخطوة التالية')}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-content-muted font-medium mt-0.5 leading-relaxed truncate">
                      {t(`tour.finish.checklist.${item.id}.desc`, '')}
                    </p>
                  </div>

                  <Chevron
                    size={16}
                    className={cn(
                      'shrink-0 transition-colors',
                      isCompleted
                        ? 'text-emerald-500/50 group-hover:text-emerald-600'
                        : isActive
                        ? 'text-brand'
                        : 'text-content-muted/50 group-hover:text-brand'
                    )}
                  />
                </motion.button>
              );
            })
          )}
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
            {completedCount === totalCount
              ? t('tour.finish.start_work', 'ابدأ العمل الآن')
              : t('tour.finish.continue', 'متابعة الخطوات')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
