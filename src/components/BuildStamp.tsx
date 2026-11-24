import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { CURRENT_BUILD } from '../lib/appVersion';

/**
 * The running build's number in small print (seen-update-delivery-fix-task.md
 * phase 1.3), read out over the phone to tell which copy is on a device. It
 * matches the live https://www.seentech.io/version.json when up to date.
 */
export default function BuildStamp({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={cn('text-sm text-content-muted select-text', className)}>
      {t('common.build_number', 'رقم النسخة')}: <bdi dir="ltr" className="tabular-nums">{CURRENT_BUILD}</bdi>
    </p>
  );
}
