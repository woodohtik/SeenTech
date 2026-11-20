import { AnimatePresence, motion } from 'motion/react';
import { ToastCard, TOAST_STACK_CLASS, type ToastStackProps } from './ToastStack';

/** The toasts' animation, as before; loaded lazily by ToastProvider (see ToastStack.tsx). */
export default function ToastMotionStack({ toasts, onClose, dir }: ToastStackProps) {
  return (
    <div className={TOAST_STACK_CLASS} dir={dir}>
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            layout
          >
            <ToastCard toast={toast} onClose={() => onClose(toast.id)} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
