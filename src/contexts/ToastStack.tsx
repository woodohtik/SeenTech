import React from 'react';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * The toast cards, without the motion library (seen-performance-first-open-
 * login-task.md Phase 2.4): ToastProvider sits on the startup path, and motion
 * (~41KB gzip) had to download before the first screen could draw because of
 * it. ToastMotionStack (loaded lazily) wraps these same cards in the same
 * enter / exit / layout animation as before; ToastStaticStack shows them at
 * once while it loads, or if it cannot load.
 */
export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  description?: string;
}

export interface ToastStackProps {
  toasts: Toast[];
  onClose: (id: string) => void;
  dir: 'rtl' | 'ltr';
}

export const TOAST_STACK_CLASS = 'fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none';

const icons = {
  success: <CheckCircle2 className="text-success" size={20} />,
  error: <AlertCircle className="text-danger" size={20} />,
  info: <Info className="text-info" size={20} />,
  warning: <AlertTriangle className="text-warning" size={20} />,
};

const bgColors = {
  success: 'bg-success/10 border-success/20',
  error: 'bg-danger/10 border-danger/20',
  info: 'bg-info/10 border-info/20',
  warning: 'bg-warning/10 border-warning/20',
};

export function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  return (
    <div
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
    </div>
  );
}

export function ToastStaticStack({ toasts, onClose, dir }: ToastStackProps) {
  return (
    <div className={TOAST_STACK_CLASS} dir={dir}>
      {toasts.map((toast) => (
        <div key={toast.id} className="seen-enter-zoom">
          <ToastCard toast={toast} onClose={() => onClose(toast.id)} />
        </div>
      ))}
    </div>
  );
}
