import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Check, MessageCircle, Plus, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { supabase } from '../../lib/supabase/client';
import { useToast } from '../../contexts/ToastContext';
import { openWhatsApp } from '../../utils/whatsapp';
import { appointmentKindsFor, appointmentReminder, countFittings, type Appointment, type AppointmentKind } from '../../utils/appointments';

/**
 * An order's appointments (seen-open-verticals-task.md, wave 1, shared item 2):
 * a women's shop's fittings (how many, a note each), a furniture shop's
 * visit and installation. Book one, mark it done or cancelled, and send the
 * customer a WhatsApp reminder.
 */
export function OrderAppointments({ order, vertical, canEdit, customerPhone }: {
  order: { id: string; tenantId?: string; tenant_id?: string; customerId?: string | null; customerName?: string | null };
  vertical: string | null | undefined;
  canEdit: boolean;
  customerPhone: string;
}) {
  const { t, i18n } = useTranslation();
  const { success, handleError } = useToast();
  const kinds = appointmentKindsFor(vertical);
  const [list, setList] = useState<Appointment[]>([]);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<AppointmentKind>(kinds[0]);
  const [when, setWhen] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const tenantId = order.tenantId ?? order.tenant_id;

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('appointments').select('*').eq('order_id', order.id).order('starts_at');
    if (!error) setList((data || []) as Appointment[]);
  }, [order.id]);
  useEffect(() => { void load(); }, [load]);

  const book = async () => {
    if (!when || saving || !tenantId) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('appointments').insert({
        tenant_id: tenantId, order_id: order.id, customer_id: order.customerId || null,
        kind, starts_at: new Date(when).toISOString(), notes: notes.trim() || null,
      });
      if (error) throw error;
      success(t('appointments.booked'));
      setAdding(false); setWhen(''); setNotes('');
      await load();
    } catch (e) { handleError(e); } finally { setSaving(false); }
  };

  const setStatus = async (a: Appointment, status: Appointment['status']) => {
    try {
      const { error } = await supabase.from('appointments').update({ status, updated_at: new Date().toISOString() }).eq('id', a.id);
      if (error) throw error;
      await load();
    } catch (e) { handleError(e); }
  };

  const fittings = countFittings(list);
  return (
    <section className="p-6 rounded-3xl border-2 border-border bg-surface space-y-4" data-testid="order-appointments">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-black text-content flex items-center gap-2">
          <CalendarClock size={18} className="text-brand" aria-hidden="true" />
          {t('appointments.title')}
          {vertical === 'womens_tailoring' && fittings > 0 && (
            <span className="text-sm font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand">{t('appointments.fittings_count', { count: fittings })}</span>
          )}
        </h3>
        {canEdit && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="min-h-11 inline-flex items-center gap-1 px-3 rounded-xl border border-border text-sm font-bold text-content hover:border-brand">
            <Plus size={16} aria-hidden="true" />{t('appointments.add')}
          </button>
        )}
      </div>

      {list.length === 0 && !adding && <p className="text-sm text-content-muted">{t('appointments.none')}</p>}
      <ul className="space-y-2">
        {list.map((a) => (
          <li key={a.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 p-3 rounded-xl border', a.status === 'cancelled' ? 'border-border/50 opacity-60' : 'border-border')}>
            <span className="font-bold text-content">{t(`appointments.kind.${a.kind}`)}</span>
            <bdi className="text-sm text-content-muted tabular-nums">
              {new Date(a.starts_at).toLocaleString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            </bdi>
            <span className="text-sm font-bold text-content-muted">{t(`appointments.status.${a.status}`)}</span>
            {a.notes && <span className="basis-full text-sm text-content">{a.notes}</span>}
            {canEdit && a.status === 'scheduled' && (
              <span className="ms-auto flex items-center gap-1">
                {customerPhone && (
                  <button type="button" onClick={() => openWhatsApp({ phone: customerPhone, message: appointmentReminder(t, a, order.customerName || '', i18n.language), kind: 'customer' })}
                    aria-label={t('appointments.remind')} title={t('appointments.remind')}
                    className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-xl text-success hover:bg-success/10">
                    <MessageCircle size={18} aria-hidden="true" />
                  </button>
                )}
                <button type="button" onClick={() => void setStatus(a, 'done')} aria-label={t('appointments.mark_done')} title={t('appointments.mark_done')}
                  className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-xl text-brand hover:bg-brand/10">
                  <Check size={18} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => void setStatus(a, 'cancelled')} aria-label={t('appointments.cancel')} title={t('appointments.cancel')}
                  className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-xl text-content-muted hover:bg-surface-muted">
                  <X size={18} aria-hidden="true" />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div className="space-y-3 p-3 rounded-xl bg-surface-muted/50 border border-border">
          <div className="grid grid-cols-1 main-640:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="appt-kind" className="block text-sm font-bold text-content">{t('appointments.kind_label')}</label>
              <select id="appt-kind" value={kind} onChange={(e) => setKind(e.target.value as AppointmentKind)}
                className="w-full h-12 px-3 rounded-xl border border-border bg-surface font-bold text-content">
                {kinds.map((k) => <option key={k} value={k}>{t(`appointments.kind.${k}`)}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="appt-when" className="block text-sm font-bold text-content">{t('appointments.when')}</label>
              <input id="appt-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
                className="w-full h-12 px-3 rounded-xl border border-border bg-surface font-bold text-content" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="appt-notes" className="block text-sm font-bold text-content">{t('appointments.notes')}</label>
            <input id="appt-notes" type="text" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full h-12 px-3 rounded-xl border border-border bg-surface text-content" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void book()} disabled={!when || saving} className="min-h-11 px-5 rounded-xl bg-brand text-white font-bold disabled:opacity-50">{t('appointments.book')}</button>
            <button type="button" onClick={() => setAdding(false)} className="min-h-11 px-4 rounded-xl text-content-muted font-bold hover:bg-surface">{t('common.cancel')}</button>
          </div>
        </div>
      )}
    </section>
  );
}
