import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getIsOnline, onConnectivityChange } from '../lib/offline/connectivity';

/**
 * A plain, unmissable "you are offline" signal -- separate from
 * OfflineStatusIndicator, which only shows once something is actually
 * queued/conflicted. This shows the moment connectivity itself is lost,
 * regardless of whether anything has been queued yet, so the cashier isn't
 * left guessing why a page suddenly feels slow/broken.
 */
export default function OfflineBanner() {
  const { t } = useTranslation();
  const [isOnline, setIsOnline] = useState(getIsOnline());

  useEffect(() => onConnectivityChange(setIsOnline), []);

  if (isOnline) return null;

  return (
    <div className="w-full bg-danger text-white px-4 py-2 flex items-center justify-center gap-2 text-sm font-bold shadow-md">
      <WifiOff size={16} className="shrink-0" />
      <span>{t('offline.no_connection', 'لا يوجد اتصال بالإنترنت الآن — النظام يعمل محلياً وسيُزامَن تلقائياً عند عودة الاتصال.')}</span>
    </div>
  );
}
