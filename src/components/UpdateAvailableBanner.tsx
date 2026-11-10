import React, { useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isUpdateAvailable, onUpdateAvailable, applyPendingUpdate } from '../lib/pwaUpdate';

/**
 * Pairs with src/lib/pwaUpdate.ts. Shown once a new deployment's service
 * worker is ready -- applying it is always the user's own choice (a click),
 * never automatic, since this app has no draft-cart persistence and an
 * unrequested reload mid-sale would lose it.
 */
export default function UpdateAvailableBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(isUpdateAvailable());

  useEffect(() => onUpdateAvailable(() => setVisible(true)), []);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="fixed top-24 inset-x-4 sm:inset-x-auto sm:end-4 sm:w-96 z-50 bg-brand text-white rounded-2xl shadow-2xl ring-2 ring-white/40 p-4 flex items-center gap-3 animate-in fade-in slide-in-from-top-2"
    >
      <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
        <RefreshCcw size={18} />
      </div>
      <div className="flex-1 text-sm font-bold leading-snug">
        <div className="text-[15px]">{t('pwa.update_available', 'يتوفر تحديث جديد')}</div>
        <div className="text-xs font-semibold text-white/85 mt-0.5">
          {t('pwa.update_available_reason', 'اضغط لتطبيقه الآن — لن يُطبَّق تلقائياً حتى لا يُفقَد أي بيع جارٍ.')}
        </div>
      </div>
      <button
        onClick={applyPendingUpdate}
        className="shrink-0 bg-white text-brand text-xs font-black px-3.5 py-2.5 rounded-xl hover:bg-white/90 transition-colors"
      >
        {t('pwa.update_now', 'تحديث الآن')}
      </button>
    </div>
  );
}
