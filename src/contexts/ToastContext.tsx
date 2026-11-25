import React, { createContext, useContext, useState, useCallback, useEffect, lazy, Suspense, ReactNode } from 'react';
import { ToastStaticStack, type Toast, type ToastType } from './ToastStack';
import { whenIdle } from '../lib/whenIdle';
import { APP_WRITE_ERROR_EVENT, getFriendlyErrorMessage, type FirestoreErrorInfo } from '../lib/appErrors';
import { logError } from '../lib/logger';
import { useTranslation } from 'react-i18next';
import { useDirection } from '../lib/direction';

interface ToastContextType {
  showToast: (type: ToastType, message: string, description?: string) => void;
  success: (message: string, description?: string) => void;
  error: (message: string, description?: string) => void;
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

  const showToast = useCallback((type: ToastType, message: string, description?: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message, description }]);
    setStackMounted(true);
    
    // Auto remove after 5 seconds
    setTimeout(() => removeToast(id), 5000);
  }, [removeToast]);

  const success = (message: string, description?: string) => showToast('success', message, description);
  const error = (message: string, description?: string) => showToast('error', message, description);
  const info = (message: string, description?: string) => showToast('info', message, description);
  const warning = (message: string, description?: string) => showToast('warning', message, description);

  const handleError = useCallback((err: any, contextStr?: string) => {
    // P4 (UX-01): already shown when appErrors raised it -- once is enough.
    if (err && (err as any).__shownToUser) {
      logError(err, { source: contextStr || 'handleError' });
      return;
    }
    // Determine friendly message
    let friendlyMessage = t('errors.unexpected');
    let description = '';

    try {
      // Check if it's our stringified JSON error
      if (err instanceof Error && err.message.startsWith('{')) {
        const parsed = JSON.parse(err.message);
        if (parsed.error && parsed.operationType) {
          friendlyMessage = getFriendlyErrorMessage(parsed);
          description = `${parsed.operationType.toUpperCase()} error at ${parsed.path || 'unknown path'}`;
        }
      } else {
        friendlyMessage = getFriendlyErrorMessage(err);
      }
      
      showToast('error', friendlyMessage, description || contextStr || t('errors.system_error'));
      logError(err, { source: contextStr || 'handleError' });
    } catch {
      showToast('error', contextStr || t('common.error'), friendlyMessage);
    }
  }, [showToast, t]);

  // P4 (UX-01): every failed save, status change or delete is shown.
  useEffect(() => {
    const onWriteError = (e: Event) => {
      const info = (e as CustomEvent<FirestoreErrorInfo>).detail;
      showToast('error', getFriendlyErrorMessage(info), t('errors.write_failed'));
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
    <ToastContext.Provider value={{ showToast, success, error, info, warning, handleError }}>
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
