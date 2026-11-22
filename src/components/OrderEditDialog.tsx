import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { dbRefusalMessage } from '../lib/appErrors';
import { useToast } from '../contexts/ToastContext';
import { isRtlLang } from '../lib/direction';

/**
 * seen-readiness-fixes-task.md P4 (OPERATIONS-06; founder question 5): change
 * a saved tailoring order. The delivery date, the tailor and the notes can
 * always change; before cutting, and while the order has no tax invoice, the
 * quantity and price of each line too (or a line removed), with a reason when
 * the total changes. update_tailoring_order on the server re-prices the order
 * and writes the change to its history.
 */

type Line = { row: any; quantity: number; price: number; removed: boolean };

export default function OrderEditDialog({ orderId, tenantId, onClose, onSaved }: {
  orderId: string;
  tenantId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { error: toastError, success: toastSuccess } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [hasInvoice, setHasInvoice] = useState(false);
  const [staff, setStaff] = useState<Array<{ id: string; name: string }>>([]);
  const [delivery, setDelivery] = useState('');
  const [tailor, setTailor] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [o, items, inv, st] = await Promise.all([
        supabase.from('orders').select('id, kind, status, notes, delivery_date, assigned_tailor_id, fabric_deducted_at, total_amount, paid_amount').eq('id', orderId).maybeSingle(),
        supabase.from('order_items').select('*').eq('order_id', orderId).order('created_at').order('id'),
        supabase.from('tax_invoices').select('id').eq('order_id', orderId).maybeSingle(),
        supabase.from('staff').select('id, name').eq('tenant_id', tenantId).eq('status', 'active').order('name'),
      ]);
      if (cancelled) return;
      if (o.error || !o.data) {
        toastError(t('orders.edit_load_failed'));
        onClose();
        return;
      }
      setOrder(o.data);
      setLines((items.data || []).map((row: any) => ({ row, quantity: Number(row.quantity) || 1, price: Number(row.price) || 0, removed: false })));
      setHasInvoice(Boolean(inv.data));
      setStaff(st.data || []);
      setDelivery(o.data.delivery_date ? String(o.data.delivery_date).slice(0, 10) : '');
      setTailor(o.data.assigned_tailor_id || '');
      const raw: string = o.data.notes || '';
      let text = raw;
      if (raw.startsWith('__B2B_METADATA__:')) {
        try { text = JSON.parse(raw.slice('__B2B_METADATA__:'.length)).originalNotes || ''; } catch { text = ''; }
      }
      setNotes(text);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [orderId, tenantId, onClose, t, toastError]);

  const linesEditable = order && !order.fabric_deducted_at && !hasInvoice;
  const linesChanged = useMemo(
    () => lines.some((l) => l.removed || l.quantity !== Number(l.row.quantity) || l.price !== Number(l.row.price)),
    [lines],
  );

  const save = async () => {
    if (!order) return;
    if (linesChanged && reason.trim().length < 3) {
      toastError(t('orders.edit_reason_required'));
      return;
    }
    const kept = lines.filter((l) => !l.removed);
    if (linesChanged && kept.length === 0) {
      toastError(t('orders.edit_needs_a_line'));
      return;
    }
    const changes: Record<string, unknown> = {};
    if (delivery && delivery !== String(order.delivery_date || '').slice(0, 10)) changes.delivery_date = new Date(`${delivery}T12:00:00`).toISOString();
    if ((tailor || null) !== (order.assigned_tailor_id || null)) changes.assigned_tailor_id = tailor || null;
    changes.notes = notes;
    const items = linesChanged
      ? kept.map(({ row, quantity, price }) => ({
        garment_type: row.garment_type, fabric: row.fabric, fabric_id: row.fabric_id,
        quantity, price,
        // The cloth a line needs follows its quantity.
        consumed_meters: row.consumed_meters ? Number(row.consumed_meters) * (quantity / (Number(row.quantity) || 1)) : 0,
        collar_type: row.collar_type, cuff_type: row.cuff_type, pocket_type: row.pocket_type, chest_style: row.chest_style,
        shoulder_style: row.shoulder_style, cutting_type: row.cutting_type, collar_padding: row.collar_padding,
        closure_type: row.closure_type, closure_visibility: row.closure_visibility,
        additions: row.additions, embroidery: row.embroidery, attributes: row.attributes, measurements: row.measurements,
      }))
      : null;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('update_tailoring_order', {
        p_operation_id: globalThis.crypto.randomUUID(),
        p_order_id: order.id,
        p_changes: changes,
        p_items: items,
        p_reason: reason.trim() || null,
      });
      if (error) throw error;
      toastSuccess((data?.changed || []).length ? t('orders.edit_saved') : t('orders.edit_nothing_changed'));
      onSaved();
      onClose();
    } catch (err) {
      toastError(dbRefusalMessage(err) ?? t('orders.edit_failed'));
    } finally {
      setSaving(false);
    }
  };

  const field = 'w-full min-h-11 rounded-xl border border-border bg-surface-muted px-3 text-sm';
  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="order-edit-title">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl bg-surface p-6 shadow-2xl border border-border space-y-4" dir={isRtlLang(i18n.language) ? 'rtl' : 'ltr'}>
        <div className="flex items-center justify-between gap-2">
          <h3 id="order-edit-title" className="text-lg font-black text-content">{t('orders.edit_title')}</h3>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-surface-muted">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-content-muted">{t('common.loading')}</p>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="text-sm font-bold text-content">{t('orders.edit_delivery_date')}</span>
              <input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} className={field} />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-bold text-content">{t('orders.edit_tailor')}</span>
              <select value={tailor} onChange={(e) => setTailor(e.target.value)} className={field}>
                <option value="">{t('orders.edit_no_tailor')}</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-bold text-content">{t('orders.edit_notes')}</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${field} py-2`} />
            </label>

            <div className="space-y-2">
              <span className="text-sm font-bold text-content">{t('orders.edit_lines')}</span>
              {!linesEditable && (
                <p className="text-xs font-bold text-content-muted rounded-xl bg-surface-muted p-3">
                  {hasInvoice ? t('orders.edit_lines_locked_invoice') : t('orders.edit_lines_locked_cut')}
                </p>
              )}
              {lines.map((l, i) => (
                <div key={l.row.id} className={`grid grid-cols-[1fr_5rem_6rem_auto] items-center gap-2 ${l.removed ? 'opacity-40' : ''}`}>
                  <span className="text-sm font-bold text-content truncate">{l.row.garment_type || l.row.name}</span>
                  <input type="number" min={1} step="any" aria-label={t('orders.edit_quantity')} disabled={!linesEditable || l.removed}
                    value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) || 1 } : x)))}
                    className={field} />
                  <input type="number" min={0} step="0.01" aria-label={t('orders.edit_price')} disabled={!linesEditable || l.removed}
                    value={l.price} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, price: Math.max(0, Number(e.target.value) || 0) } : x)))}
                    className={field} />
                  <button type="button" disabled={!linesEditable} onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, removed: !x.removed } : x)))}
                    className="min-h-11 px-2 rounded-xl border border-border text-xs font-bold disabled:opacity-40">
                    {l.removed ? t('orders.edit_restore_line') : t('orders.edit_remove_line')}
                  </button>
                </div>
              ))}
            </div>

            {linesChanged && (
              <label className="block space-y-1">
                <span className="text-sm font-bold text-content">{t('orders.edit_reason')}</span>
                <input value={reason} onChange={(e) => setReason(e.target.value)} className={field} placeholder={t('orders.edit_reason_placeholder')} />
              </label>
            )}

            <div className="flex gap-2 pt-2">
              <button type="button" onClick={() => void save()} disabled={saving}
                className="flex-1 min-h-12 rounded-2xl bg-brand text-white font-bold disabled:opacity-50">
                {t('orders.edit_save')}
              </button>
              <button type="button" onClick={onClose} disabled={saving}
                className="flex-1 min-h-12 rounded-2xl border border-border font-bold text-content">
                {t('orders.cancel_back')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
