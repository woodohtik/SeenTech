import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import { getFriendlyErrorMessage } from '../lib/firebase';
import { logError } from '../lib/logger';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  description?: string;
}

interface ToastContextType {
  showToast: (type: ToastType, message: string, description?: string) => void;
  success: (message: string, description?: string) => void;
  error: (message: string, description?: string) => void;
  info: (message: string, description?: string) => void;
  warning: (message: string, description?: string) => void;
  handleError: (err: any, contextStr?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((type: ToastType, message: string, description?: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message, description }]);
    
    // Auto remove after 5 seconds
    setTimeout(() => removeToast(id), 5000);
  }, [removeToast]);

  const success = (message: string, description?: string) => showToast('success', message, description);
  const error = (message: string, description?: string) => showToast('error', message, description);
  const info = (message: string, description?: string) => showToast('info', message, description);
  const warning = (message: string, description?: string) => showToast('warning', message, description);

  const handleError = useCallback((err: any, contextStr?: string) => {
    // Determine friendly message
    let friendlyMessage = 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.';
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
      
      showToast('error', friendlyMessage, description || contextStr || 'خطأ في النظام');
      logError(err, { source: contextStr || 'handleError' });
    } catch {
      showToast('error', contextStr || 'خطأ', friendlyMessage);
    }
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, success, error, info, warning, handleError }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none" dir="rtl">
        <AnimatePresence>
          {toasts.map((toast) => (
            <ToastItem 
              key={toast.id} 
              toast={toast} 
              onClose={() => removeToast(toast.id)} 
            />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void; key?: React.Key }) {
  const icons = {
    success: <CheckCircle2 className="text-green-500" size={20} />,
    error: <AlertCircle className="text-red-500" size={20} />,
    info: <Info className="text-blue-500" size={20} />,
    warning: <AlertTriangle className="text-amber-500" size={20} />,
  };

  const bgColors = {
    success: 'bg-green-50 border-green-100',
    error: 'bg-red-50 border-red-100',
    info: 'bg-blue-50 border-blue-100',
    warning: 'bg-amber-50 border-amber-100',
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 50, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      layout
      className={cn(
        "pointer-events-auto flex gap-4 min-w-[320px] max-w-[420px] p-4 rounded-2xl border shadow-xl bg-surface",
        bgColors[toast.type]
      )}
    >
      <div className="mt-0.5">{icons[toast.type]}</div>
      <div className="flex-1">
        <h4 className="text-sm font-black text-content">{toast.message}</h4>
        {toast.description && (
          <p className="mt-1 text-xs font-bold text-content-muted leading-relaxed">
            {toast.description}
          </p>
        )}
      </div>
      <button 
        onClick={onClose}
        className="h-fit p-1 text-content-muted hover:text-content transition-colors rounded-lg hover:bg-black/5"
      >
        <X size={16} />
      </button>
    </motion.div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
