import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { DialogFrame } from '../ui/DialogFrame';
import { supabase } from '../../lib/supabase/client';
import { useToast } from '../../contexts/ToastContext';

/**
 * The end of a roll as a remnant (seen-open-verticals-task.md, wave 1, fabric
 * stores item 3): its length and its price as a piece; convert_to_remnant
 * takes the metres from the fabric and makes «بواقي: … — 1.2 م», one piece.
 */
export function ConvertToRemnantDialog({ item, available, onClose, onDone }: {
  item: { id: string; name: string };
  /** Metres in stock (shown, and the most that can be converted). */
  available: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { success, handleError } = useToast();
  const [meters, setMeters] = useState('');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const m = Number(meters.replace(',', '.'));
  const p = Number(price.replace(',', '.'));
  const valid = m > 0 && m <= available && p >= 0 && price.trim() !== '';

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('convert_to_remnant', { p_item_id: item.id, p_variant_id: null, p_meters: m, p_price: p });
      if (error) throw error;
      success(t('inventory.remnant.done', { meters: m }));
      onDone();
      onClose();
    } catch (e) {
      handleError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogFrame onClose={onClose} labelledBy="remnant-title"
      overlayClassName="flex items-end main-640:items-center justify-center p-0 main-640:p-4"
      panelClassName="bg-surface w-full max-w-md rounded-t-3xl main-640:rounded-3xl shadow-2xl border border-border p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="remnant-title" className="text-lg font-black text-content">{t('inventory.remnant.title')}</h2>
          <p className="text-sm text-content-muted mt-1">{item.name} · {t('inventory.remnant.available', { meters: available })}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('common.close')} className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-full text-content-muted hover:bg-surface-muted">
          <X size={20} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="remnant-meters" className="block text-base font-bold text-content">{t('inventory.remnant.meters')}</label>
          <input id="remnant-meters" type="text" inputMode="decimal" dir="ltr" value={meters} onChange={(e) => setMeters(e.target.value)}
            className="w-full h-12 px-4 rounded-xl border border-border bg-surface font-bold text-content tabular-nums outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" />
        </div>
        <div className="space-y-2">
          <label htmlFor="remnant-price" className="block text-base font-bold text-content">{t('inventory.remnant.price')}</label>
          <input id="remnant-price" type="text" inputMode="decimal" dir="ltr" value={price} onChange={(e) => setPrice(e.target.value)}
            className="w-full h-12 px-4 rounded-xl border border-border bg-surface font-bold text-content tabular-nums outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" />
        </div>
      </div>
      {m > available && <p role="alert" className="text-sm font-bold text-danger">{t('inventory.remnant.too_much', { meters: available })}</p>}
      <button type="button" onClick={() => void save()} disabled={!valid || saving}
        className="w-full h-12 rounded-xl bg-brand text-white font-black disabled:opacity-50">
        {t('inventory.remnant.convert')}
      </button>
    </DialogFrame>
  );
}

/** Days since a remnant was made: an old remnant is marked down. */
export function remnantAgeDays(createdAt: string | null | undefined, now: Date = new Date()): number {
  if (!createdAt) return 0;
  const ms = now.getTime() - new Date(createdAt).getTime();
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}
