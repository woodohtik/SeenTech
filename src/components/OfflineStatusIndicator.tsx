import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CloudOff, AlertTriangle, ChevronUp, ChevronDown, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { offlineDb } from '../lib/offline/db';
import {
  getZatcaApproachingEntries,
  getExhaustedOutboxEntries,
  getEntriesNeedingAttention,
  describeOutboxEntry,
  requeueOutboxEntry,
  drainOutbox,
  type OutboxEntryDescription,
} from '../lib/offline/outbox';
import { PriceDisplay } from './PriceDisplay';
import { localeOf } from '../lib/direction';
import { getStockConflictCount } from '../lib/offline/stockConflicts';
import { cn } from '../lib/utils';

/**
 * Persistent, always-visible offline status (seen-offline-sync-architecture
 * -task.md Phase 4) -- a cashier's trust that a queued sale is real data
 * waiting to send, not silently lost, is the single most important trust
 * signal in any offline POS. Shows nothing at all once the queue is empty
 * and no conflicts are outstanding -- this is a "something needs your
 * attention" indicator, not permanent chrome.
 */
export default function OfflineStatusIndicator({ tenantId }: { tenantId?: string }) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [zatcaWarningCount, setZatcaWarningCount] = useState(0);
  const [stockConflictCount, setStockConflictCount] = useState(0);
  const [exhaustedCount, setExhaustedCount] = useState(0);
  // Team review M-9: the operations that failed for good, with what they were
  // and why -- staff took money for them, a bare count was not enough.
  const [exhausted, setExhausted] = useState<OutboxEntryDescription[]>([]);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [recheck, setRecheck] = useState(0);

  const pendingEntries = useLiveQuery(
    () => offlineDb.outbox.where('status').anyOf('pending', 'syncing', 'failed').toArray(),
    [],
    []
  );
  const pendingCount = pendingEntries?.length ?? 0;

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const zatcaEntries = await getZatcaApproachingEntries();
      if (!cancelled) setZatcaWarningCount(zatcaEntries.length);
      const exhaustedEntries = await getExhaustedOutboxEntries();
      // P3.3 / RELIABILITY-04: the list (with its send-again button) covers every
      // failed or stuck entry, not only those that ran out of attempts.
      const attention = await getEntriesNeedingAttention();
      const described = await Promise.all(attention.map(describeOutboxEntry));
      if (!cancelled) {
        setExhaustedCount(exhaustedEntries.length);
        setExhausted(described.sort((a, b) => a.createdAt - b.createdAt));
      }
      if (tenantId) {
        const conflicts = await getStockConflictCount(tenantId);
        if (!cancelled) setStockConflictCount(conflicts);
      }
    };
    void check();
    // Only while the tab is visible (seen-performance-first-open-login-task.md Phase 5).
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [tenantId, pendingCount, recheck]);

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      await requeueOutboxEntry(id);
      await drainOutbox();
    } finally {
      setRetrying(null);
      setRecheck((n) => n + 1);
    }
  };

  const kindLabel = (kind: OutboxEntryDescription['kind']) =>
    kind === 'pos_sale' ? t('offline.review_kind_pos_sale', 'بيع من نقطة البيع')
      : kind === 'tailoring_order' || kind === 'order_create' ? t('offline.review_kind_tailoring_order', 'طلب تفصيل')
        : t('offline.review_kind_other', 'عملية');

  const hasAttention = pendingCount > 0 || stockConflictCount > 0;
  if (!hasAttention) return null;

  const hasUrgent = zatcaWarningCount > 0 || stockConflictCount > 0 || exhaustedCount > 0;

  return (
    // bottom-24 below lg: السِين الذكي (SeenAIFab.tsx) ثابت عند bottom-6
    // start-6 (=right-6 في RTL) على نفس المدى، بـz-50 أعلى -- فكان يُغطّي
    // هذا المؤشر بالكامل. يرتفع فوقه فقط أدنى من lg: (حيث ينتقل زر المساعد
    // للزاوية المقابلة أصلاً فلا تعارض هناك).
    <div className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] lg:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] start-6 z-40 flex flex-col items-start gap-2">
      {expanded && (
        <div className="bg-surface border border-border rounded-2xl shadow-xl p-4 w-72 text-sm space-y-2.5">
          {pendingCount > 0 && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-content-muted font-bold">{t('offline.pending_sync', 'عمليات بانتظار المزامنة')}</span>
              <span className="font-black text-content">{pendingCount}</span>
            </div>
          )}
          {exhaustedCount > 0 && (
            <div className="flex items-start gap-2 text-danger font-bold bg-danger/10 rounded-xl p-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>
                {t('offline.exhausted_warning', '{{count}} عملية فشلت في المزامنة نهائياً ولن تُعاد محاولتها تلقائياً — تحتاج مراجعة يدوية.', { count: exhaustedCount })}
              </span>
            </div>
          )}
          {exhausted.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-content-muted font-bold leading-relaxed">
                {t('offline.review_hint', 'حُصِّل مبلغ لهذه العمليات. أعد إرسالها؛ وإن رُفضت مرة أخرى فأنشئ الطلب يدوياً بنفس البيانات ولا تحذف هذا السجل.')}
              </p>
              <ul className="space-y-2 max-h-64 overflow-y-auto">
                {exhausted.map((op) => (
                  <li key={op.id} className="border border-danger/30 rounded-xl p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black text-content text-xs">{kindLabel(op.kind)}</span>
                      <span className="text-[10px] text-content-muted font-bold" dir="ltr">
                        {new Date(op.createdAt).toLocaleString(localeOf(i18n.language), { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-content">
                      {op.customerName || t('offline.review_unknown_customer', 'عميل غير محدد')}
                      {op.paid > 0 && (
                        <span className="text-content-muted"> · {t('offline.review_paid', 'المحصَّل')}: <PriceDisplay amount={op.paid} /></span>
                      )}
                    </div>
                    {op.reason && (
                      <div className="text-[11px] text-danger font-bold leading-relaxed break-words">
                        {t('offline.review_reason', 'السبب')}: {op.reason}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => retry(op.id)}
                      disabled={retrying !== null}
                      className="mt-1 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-surface-muted hover:bg-border text-content text-xs font-black disabled:opacity-60 transition-colors"
                    >
                      <RotateCw size={12} className={retrying === op.id ? 'animate-spin' : ''} />
                      {t('offline.review_retry', 'إعادة الإرسال')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {zatcaWarningCount > 0 && (
            <div className="flex items-start gap-2 text-danger font-bold bg-danger/10 rounded-xl p-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>
                {t('offline.zatca_warning', '{{count}} فاتورة تقترب من سقف الـ24 ساعة القانوني للإبلاغ لهيئة الزكاة والضريبة دون مزامنة بعد.', { count: zatcaWarningCount })}
              </span>
            </div>
          )}
          {stockConflictCount > 0 && (
            <div className="flex items-start gap-2 text-warning font-bold bg-warning/10 rounded-xl p-2.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>
                {t('offline.stock_conflict_warning', '{{count}} صنف بِيع أكثر من المتاح فعلياً — يحتاج مطابقة مخزون يدوية.', { count: stockConflictCount })}
              </span>
            </div>
          )}
        </div>
      )}
      <button
        onClick={() => setExpanded(v => !v)}
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 rounded-2xl shadow-lg font-black text-sm border transition-colors",
          hasUrgent
            ? "bg-danger text-white border-danger"
            : "bg-surface text-content border-border"
        )}
      >
        <CloudOff size={16} />
        {pendingCount > 0 && <span>{t('offline.pending_count_badge', '{{count}} قيد المزامنة', { count: pendingCount })}</span>}
        {pendingCount === 0 && stockConflictCount > 0 && <span>{t('offline.conflicts_badge', '{{count}} تعارض مخزون', { count: stockConflictCount })}</span>}
        {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
    </div>
  );
}
