import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * seen-admin-reengineering-task.md بند 1 -- مصدر واحد لارتفاع الشريط، بدل
 * قيمة مخمَّنة مكرَّرة (top-12 هنا، margin-top هناك) في كل مكان يُعوَّض عنه.
 */
export const IMPERSONATION_BANNER_HEIGHT = 44;

interface ImpersonationBannerProps {
  tenantId: string | null;
  tenantLabel?: string | null;
  onEnd: () => void;
}

export default function ImpersonationBanner({ tenantId, tenantLabel, onEnd }: ImpersonationBannerProps) {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {tenantId && (
        <motion.div
          initial={{ y: -100 }}
          animate={{ y: 0 }}
          exit={{ y: -100 }}
          style={{ height: IMPERSONATION_BANNER_HEIGHT }}
          className="fixed top-0 left-0 right-0 z-[200] bg-warning text-white py-2 px-4 flex items-center justify-center gap-4 shadow-xl"
        >
          <div className="flex items-center gap-2 font-black text-sm">
            <AlertCircle size={18} />
            <span>{t('common.support_mode_desc')}</span>
          </div>
          <div className="h-4 w-px bg-surface/30 mx-2" />
          <span className="text-xs font-bold">{t('common.current_subscriber')}: {tenantLabel || tenantId}</span>
          <button
            onClick={onEnd}
            className="bg-surface text-warning px-4 py-1 rounded-full text-xs font-black hover:bg-surface/90 transition-all ml-4"
          >
            {t('common.end_impersonation')}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
