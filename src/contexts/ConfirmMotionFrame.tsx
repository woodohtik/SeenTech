import { AnimatePresence, motion } from 'motion/react';
import { CONFIRM_BACKDROP_CLASS, CONFIRM_PANEL_CLASS, type ConfirmFrameProps } from './ConfirmFrame';

/** The dialog's animation, as before; loaded lazily by ConfirmProvider (see ConfirmFrame.tsx). */
export default function ConfirmMotionFrame({ open, dir, onBackdrop, children }: ConfirmFrameProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={CONFIRM_BACKDROP_CLASS}
          dir={dir}
          onClick={onBackdrop}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            className={CONFIRM_PANEL_CLASS}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
