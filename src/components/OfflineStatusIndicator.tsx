import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CloudOff, AlertTriangle, ChevronUp, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { offlineDb } from '../lib/offline/db';
import { getZatcaApproachingEntries, getExhaustedOutboxEntries } from '../lib/offline/outbox';
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
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [zatcaWarningCount, setZatcaWarningCount] = useState(0);
  const [stockConflictCount, setStockConflictCount] = useState(0);
  const [exhaustedCount, setExhaustedCount] = useState(0);

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
      const exhausted = await getExhaustedOutboxEntries();
      if (!cancelled) setExhaustedCount(exhausted.length);
      if (tenantId) {
        const conflicts = await getStockConflictCount(tenantId);
        if (!cancelled) setStockConflictCount(conflicts);
      }
    };
    void check();
    const interval = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [tenantId, pendingCount]);

  const hasAttention = pendingCount > 0 || stockConflictCount > 0;
  if (!hasAttention) return null;

  const hasUrgent = zatcaWarningCount > 0 || stockConflictCount > 0 || exhaustedCount > 0;

  return (
    <div className="fixed bottom-6 start-6 z-40 flex flex-col items-start gap-2">
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
