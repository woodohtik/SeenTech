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
    <div className="fixed top-24 inset-x-4 sm:inset-x-auto sm:end-4 sm:w-80 z-50 bg-content text-white rounded-2xl shadow-2xl p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
        <RefreshCcw size={16} />
      </div>
      <div className="flex-1 text-sm font-bold leading-snug">
        {t('pwa.update_available', 'يتوفر تحديث جديد للنظام')}
      </div>
      <button
        onClick={applyPendingUpdate}
        className="shrink-0 bg-white text-content text-xs font-black px-3.5 py-2 rounded-xl hover:bg-white/90 transition-colors"
      >
        {t('pwa.update_now', 'تحديث الآن')}
      </button>
    </div>
  );
}
