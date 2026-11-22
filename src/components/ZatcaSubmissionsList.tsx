import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { localeOf } from '../lib/direction';

/**
 * seen-readiness-fixes-task.md P2.4: the owner sees what happened to every
 * invoice and credit note sent to ZATCA from the server's queue -- sent,
 * waiting, being retried, rejected with ZATCA's reason, or given up on.
 */
type Row = {
  id: string;
  kind: 'invoice' | 'credit_note';
  ref_id: string;
  status: string;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
};

const STATUS_STYLE: Record<string, string> = {
  sent: 'bg-success/10 text-success',
  pending: 'bg-surface-muted text-content-muted',
  sending: 'bg-brand/10 text-brand',
  retry: 'bg-warning/10 text-warning',
  rejected: 'bg-danger/10 text-danger',
  failed: 'bg-danger/10 text-danger',
  not_applicable: 'bg-surface-muted text-content-muted',
};

export default function ZatcaSubmissionsList({ tenantId }: { tenantId: string }) {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase
      .from('zatca_submissions')
      .select('id, kind, ref_id, status, attempts, next_attempt_at, last_error, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    const list = (data || []) as Row[];
    setRows(list);
    // The document numbers the owner knows them by.
    const orderIds = list.filter((r) => r.kind === 'invoice').map((r) => r.ref_id);
    const returnIds = list.filter((r) => r.kind === 'credit_note').map((r) => r.ref_id);
    const [inv, ret] = await Promise.all([
      orderIds.length ? supabase.from('tax_invoices').select('order_id, invoice_number').in('order_id', orderIds) : Promise.resolve({ data: [] as any[] }),
      returnIds.length ? supabase.from('sales_returns').select('id, return_number').in('id', returnIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const map: Record<string, string> = {};
    for (const i of (inv.data || []) as any[]) map[`invoice:${i.order_id}`] = i.invoice_number;
    for (const r of (ret.data || []) as any[]) map[`credit_note:${r.id}`] = r.return_number;
    setNumbers(map);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const fmt = (iso: string) => new Date(iso).toLocaleString(localeOf(i18n.language), { dateStyle: 'short', timeStyle: 'short' });

  return (
    <section className="rounded-3xl border border-border bg-surface p-5 space-y-4" aria-labelledby="zatca-submissions-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id="zatca-submissions-title" className="text-lg font-black text-content">{t('zatca_queue.title')}</h3>
          <p className="text-xs text-content-muted">{t('zatca_queue.subtitle')}</p>
        </div>
        <button type="button" onClick={() => void load()} className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl border border-border" aria-label={t('zatca_queue.refresh')}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loadError ? (
        <p className="text-sm text-danger">{t('zatca_queue.load_failed')}</p>
      ) : !loading && rows.length === 0 ? (
        <p className="text-sm text-content-muted">{t('zatca_queue.empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="py-3 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-content">
                  {t(`zatca_queue.kind_${r.kind}`)} {numbers[`${r.kind}:${r.ref_id}`] ?? ''}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_STYLE[r.status] ?? STATUS_STYLE.pending}`}>
                  {t(`zatca_queue.status_${r.status}`)}
                </span>
              </div>
              <div className="text-xs text-content-muted">
                {fmt(r.created_at)}
                {r.status === 'retry' && <> · {t('zatca_queue.next_try', { when: fmt(r.next_attempt_at), attempts: r.attempts })}</>}
              </div>
              {r.last_error && (r.status === 'rejected' || r.status === 'failed' || r.status === 'retry') && (
                <p className="text-xs text-danger break-words">{r.last_error}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
