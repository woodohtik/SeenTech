import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { usePosLengthStep } from '../../hooks/usePosLengthStep';
import { LENGTH_STEPS } from '../../utils/lengthSale';
import { supabase } from '../../lib/supabase/client';
import { useToast } from '../../contexts/ToastContext';

/**
 * A fabric store's POS step for lengths (seen-open-verticals-task.md, wave 1):
 * how much one ± press adds -- 5 cm to a metre. Saved on its own (its route
 * changes this setting only).
 */
export function PosLengthStepSetting({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const { success, handleError } = useToast();
  const [step, setStep] = usePosLengthStep(tenantId);
  const [saving, setSaving] = useState(false);

  const choose = async (next: number) => {
    if (next === step || saving) return;
    const previous = step;
    setStep(next);
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/tenant/pos-length-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ step: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'save_failed');
      success(t('settings_page.pos_length_step.saved'));
    } catch (e) {
      setStep(previous);
      handleError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="pos-length-step">
      <div className="px-1">
        <h4 className="text-base font-bold text-content">{t('settings_page.pos_length_step.title')}</h4>
        <p className="text-sm text-content-muted mt-1">{t('settings_page.pos_length_step.desc')}</p>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('settings_page.pos_length_step.title')}>
        {LENGTH_STEPS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={step === s}
            disabled={saving}
            onClick={() => void choose(s)}
            className={cn('min-h-11 min-w-16 px-4 rounded-[var(--radius-md)] border text-sm font-bold tabular-nums',
              step === s ? 'bg-brand text-white border-brand' : 'bg-surface text-content border-border hover:border-brand')}
          >
            <bdi dir="ltr">{s < 1 ? `${Math.round(s * 100)} ${t('settings_page.pos_length_step.cm')}` : `1 ${t('settings_page.pos_length_step.m')}`}</bdi>
          </button>
        ))}
      </div>
    </div>
  );
}
