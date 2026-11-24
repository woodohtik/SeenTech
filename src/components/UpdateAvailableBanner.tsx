import React, { useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { applyUpdateNow, getUpdateStatus, onUpdateStatus, type UpdateStatus } from '../lib/updateManager';
import { hardRecover } from '../lib/chunkRecovery';

/**
 * What the person sees of an update (seen-update-delivery-fix-task.md 3.2).
 * On a safe screen nothing: the update applies by itself. Otherwise:
 *  - waiting: a fixed bar, not closable, "applies after this"; the button
 *    is only an option;
 *  - mandatory: a full screen with one button;
 *  - stuck: the automatic way failed twice; one button the hard way.
 */
export default function UpdateAvailableBanner() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus>(getUpdateStatus());
  useEffect(() => onUpdateStatus(setStatus), []);

  if (status === 'none') return null;

  if (status === 'mandatory') {
    return (
      <div role="alertdialog" aria-modal="true" aria-labelledby="seen-update-required-title"
        className="fixed inset-0 z-[200] bg-surface-muted flex flex-col items-center justify-center gap-4 p-6 text-center text-content">
        <RefreshCcw size={32} className="text-brand" aria-hidden="true" />
        <h2 id="seen-update-required-title" className="text-2xl font-heading font-extrabold">{t('pwa.update_required_title', 'تحديث مطلوب')}</h2>
        <p className="max-w-sm text-base text-content-muted">{t('pwa.update_required_body', 'هذه النسخة من سين لم تعد تعمل. حدّث للمتابعة. المبيعات غير المرسلة تبقى محفوظة على الجهاز.')}</p>
        <button type="button" onClick={() => { void applyUpdateNow(); }}
          className="min-h-12 px-6 rounded-[8px] bg-brand text-white font-semibold text-lg">
          {t('pwa.update_now', 'تحديث الآن')}
        </button>
      </div>
    );
  }

  const text = status === 'applying'
    ? t('pwa.update_applying', 'جارٍ التحديث…')
    : status === 'stuck'
      ? t('pwa.update_stuck', 'تعذّر تطبيق التحديث تلقائياً. اضغط «تحديث».')
      : t('pwa.update_ready_after_task', 'تحديث جاهز — يُطبَّق بعد إتمام العملية');

  return (
    <div role="status"
      className="fixed top-24 inset-x-4 sm:inset-x-auto sm:end-4 sm:w-96 z-50 bg-brand text-white rounded-[12px] p-4 flex items-center gap-3 shadow-[var(--seen-shadow-float)]">
      <RefreshCcw size={18} className={status === 'applying' ? 'shrink-0 animate-spin motion-reduce:animate-none' : 'shrink-0'} aria-hidden="true" />
      <p className="flex-1 text-base font-semibold leading-snug">{text}</p>
      {status === 'waiting-for-safe' && (
        <button type="button" onClick={() => { void applyUpdateNow(); }}
          className="shrink-0 min-h-11 bg-white text-brand text-sm font-bold px-3.5 rounded-[8px] hover:bg-white/90">
          {t('pwa.update_now', 'تحديث الآن')}
        </button>
      )}
      {status === 'stuck' && (
        <button type="button" onClick={() => { void hardRecover(); }}
          className="shrink-0 min-h-11 bg-white text-brand text-sm font-bold px-3.5 rounded-[8px] hover:bg-white/90">
          {t('errors.update_button', 'تحديث')}
        </button>
      )}
    </div>
  );
}
