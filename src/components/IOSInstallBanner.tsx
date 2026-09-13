import React, { useEffect, useState } from 'react';
import { X, Share, PlusSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const DISMISS_KEY = 'ios_install_banner_dismissed_at';

/**
 * seen-offline-sync-architecture-task.md Phase 2's iOS note: Safari deletes
 * a site's local storage (IndexedDB included) after 7 consecutive days with
 * no real user interaction -- a policy that does not apply once the app is
 * installed via "Add to Home Screen". This nudges staff on iOS Safari
 * (not the installed/standalone app, not the native Capacitor build) to do
 * that install, since it's the only real fix and can't be done from code.
 *
 * Dismissal is per-session (sessionStorage), not permanent: an unread
 * dismissal shouldn't silently waive a real data-loss risk for good.
 */
export default function IOSInstallBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const isStandalone =
      (window.navigator as any).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = sessionStorage.getItem(DISMISS_KEY);
    setVisible(isIOS && !isStandalone && !dismissed);
  }, []);

  if (!visible) return null;

  return (
    <div className="bg-warning/10 border-b border-warning/30 text-content px-4 py-2.5 flex items-center gap-3 text-sm relative z-40">
      <span className="flex-1">
        {t(
          'offline.ios_install_banner',
          'لتفادي حذف سفاري لبيانات هذا الجهاز تلقائياً بعد أسبوع من عدم الاستخدام: ثبّت التطبيق عبر زر المشاركة'
        )}{' '}
        <Share size={14} className="inline mx-0.5 -mt-0.5" />{' '}
        {t('offline.ios_install_then', 'ثم')}{' '}
        <span className="font-bold inline-flex items-center gap-1">
          {t('offline.ios_install_add_to_home', 'أضف إلى الشاشة الرئيسية')}
          <PlusSquare size={14} />
        </span>
      </span>
      <button
        onClick={() => {
          sessionStorage.setItem(DISMISS_KEY, '1');
          setVisible(false);
        }}
        aria-label={t('common.dismiss', 'إغلاق')}
        className="shrink-0 p-1 rounded-lg hover:bg-warning/20 text-content-muted hover:text-content"
      >
        <X size={16} />
      </button>
    </div>
  );
}
