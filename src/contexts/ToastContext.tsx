import React, { createContext, useContext, useState, useCallback, useEffect, lazy, Suspense, ReactNode } from 'react';
import { ToastStaticStack, type Toast, type ToastType } from './ToastStack';
import { whenIdle } from '../lib/whenIdle';
import { APP_WRITE_ERROR_EVENT, type FirestoreErrorInfo } from '../lib/appErrors';
import { toUserError, type UserErrorContext } from '../lib/userFacingError';
import { logError } from '../lib/logger';
import { useTranslation } from 'react-i18next';
import { useDirection } from '../lib/direction';

interface ToastContextType {
  showToast: (type: ToastType, message: string, description?: string, extra?: { code?: string; details?: string }) => void;
  success: (message: string, description?: string) => void;
  /**
   * A text you wrote -- or the error itself (seen-friendly-errors-everywhere-task.md):
   * error(err) shows its plain title, what to do and its code, and logs it.
   * Never pass an error's .message here.
   */
  error: (messageOrError: unknown, description?: string) => void;
  /** The error itself, as the person should see it. */
  showError: (err: unknown, context?: UserErrorContext) => void;
  info: (message: string, description?: string) => void;
  warning: (message: string, description?: string) => void;
  handleError: (err: any, contextStr?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// The animated stack (motion library) loads off the startup path: fetched
// when the browser is idle, mounted from the first toast on (kept mounted so
// exit animations play). Until it is there -- or if it cannot load -- the
// same cards show without animation (ToastStack.tsx).
const loadToastMotionStack = () => import('./ToastMotionStack');
const ToastMotionStack = lazy(() => loadToastMotionStack().catch(() => ({ default: ToastStaticStack })));

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [stackMounted, setStackMounted] = useState(false);

  useEffect(() => whenIdle(() => { loadToastMotionStack().catch(() => {}); }), []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((type: ToastType, message: string, description?: string, extra?: { code?: string; details?: string }) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message, description, ...extra }]);
    setStackMounted(true);

    // Auto remove after 5 seconds (an error with its details: long enough to read them)
    setTimeout(() => removeToast(id), extra?.details ? 12000 : 5000);
  }, [removeToast]);

  // seen-friendly-errors-everywhere-task.md: one way an error reaches the screen.
  const showError = useCallback((err: unknown, context?: UserErrorContext) => {
    const ue = toUserError(err, context);
    showToast('error', ue.title, ue.action || undefined, { code: ue.kind === 'refusal' ? undefined : ue.code, details: ue.technical });
  }, [showToast]);

  const success = (message: string, description?: string) => showToast('success', message, description);
  const error = (messageOrError: unknown, description?: string) => {
    if (typeof messageOrError === 'string') showToast('error', messageOrError, description);
    else showError(messageOrError);
  };
  const info = (message: string, description?: string) => showToast('info', message, description);
  const warning = (message: string, description?: string) => showToast('warning', message, description);

  const handleError = useCallback((err: any, contextStr?: string) => {
    // P4 (UX-01): already shown when appErrors raised it -- once is enough.
    if (err && (err as any).__shownToUser) {
      logError(err, { source: contextStr || 'handleError' });
      return;
    }
    // Never the table or the operation ("INSERT error at ..."): those are ours.
    // The caller's text (what failed, already translated) is the title; our
    // sentence for the error and its code go under it.
    if (!contextStr) {
      showError(err, { where: 'handleError' });
      return;
    }
    const ue = toUserError(err, { where: contextStr });
    showToast('error', contextStr, ue.message, { code: ue.kind === 'refusal' ? undefined : ue.code, details: ue.technical });
  }, [showError, showToast]);

  // P4 (UX-01): every failed save, status change or delete is shown.
  useEffect(() => {
    const onWriteError = (e: Event) => {
      const info = (e as CustomEvent<FirestoreErrorInfo>).detail;
      const ue = toUserError(info, { where: `${info.operationType}:${info.path ?? ''}` });
      showToast('error', t('errors.write_failed'), ue.message, { code: ue.kind === 'refusal' ? undefined : ue.code, details: ue.technical });
    };
    window.addEventListener(APP_WRITE_ERROR_EVENT, onWriteError);
    // P4 (OPERATIONS-13): a send refused because the shop turned WhatsApp off.
    const onWhatsAppOff = () => showToast('info', t('settings_page.whatsapp.disabled_notice'));
    window.addEventListener('seen-whatsapp-disabled', onWhatsAppOff);
    // seen-whatsapp-templates-task.md: a number that cannot be a WhatsApp number.
    const onBadPhone = () => showToast('error', t('whatsapp.invalid_phone'));
    window.addEventListener('seen-whatsapp-invalid-phone', onBadPhone);
    return () => {
      window.removeEventListener(APP_WRITE_ERROR_EVENT, onWriteError);
      window.removeEventListener('seen-whatsapp-disabled', onWhatsAppOff);
      window.removeEventListener('seen-whatsapp-invalid-phone', onBadPhone);
    };
  }, [showToast, t]);

  return (
    <ToastContext.Provider value={{ showToast, success, error, showError, info, warning, handleError }}>
      {children}
      {stackMounted && (
        <Suspense fallback={<ToastStaticStack toasts={toasts} onClose={removeToast} dir={dir} />}>
          <ToastMotionStack toasts={toasts} onClose={removeToast} dir={dir} />
        </Suspense>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
