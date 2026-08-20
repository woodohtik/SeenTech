import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, HelpCircle, Info } from 'lucide-react';
import { cn } from '../lib/utils';
import { useDirection } from '../lib/direction';

interface ConfirmOptions {
  title?: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface AlertOptions {
  title?: string;
  description: string;
  closeLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title?: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

type DialogRequest =
  | ({ kind: 'confirm' } & ConfirmOptions & { resolve: (value: boolean) => void })
  | ({ kind: 'alert' } & AlertOptions & { resolve: () => void })
  | ({ kind: 'prompt' } & PromptOptions & { resolve: (value: string | null) => void });

interface ConfirmContextType {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  alertModal: (options: AlertOptions | string) => Promise<void>;
  promptText: (options: PromptOptions | string) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { dir, t } = useDirection();
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [promptValue, setPromptValue] = useState('');

  const confirm = useCallback((options: ConfirmOptions | string) => {
    const opts = typeof options === 'string' ? { description: options } : options;
    return new Promise<boolean>((resolve) => {
      setDialog({ kind: 'confirm', ...opts, resolve });
    });
  }, []);

  const alertModal = useCallback((options: AlertOptions | string) => {
    const opts = typeof options === 'string' ? { description: options } : options;
    return new Promise<void>((resolve) => {
      setDialog({ kind: 'alert', ...opts, resolve });
    });
  }, []);

  const promptText = useCallback((options: PromptOptions | string) => {
    const opts = typeof options === 'string' ? { description: options } : options;
    setPromptValue(opts.defaultValue || '');
    return new Promise<string | null>((resolve) => {
      setDialog({ kind: 'prompt', ...opts, resolve });
    });
  }, []);

  const close = (result: any) => {
    if (!dialog) return;
    if (dialog.kind === 'confirm') dialog.resolve(result as boolean);
    else if (dialog.kind === 'alert') dialog.resolve();
    else dialog.resolve(result as string | null);
    setDialog(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm, alertModal, promptText }}>
      {children}
      <AnimatePresence>
        {dialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            dir={dir}
            onClick={() => close(dialog.kind === 'confirm' ? false : dialog.kind === 'prompt' ? null : undefined)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface rounded-3xl shadow-2xl w-full max-w-sm border border-border p-6 space-y-5 text-center"
            >
              <div
                className={cn(
                  "w-14 h-14 mx-auto rounded-full flex items-center justify-center",
                  'danger' in dialog && dialog.danger ? "bg-danger/10 text-danger" : "bg-brand/10 text-brand"
                )}
              >
                {dialog.kind === 'confirm' ? (
                  dialog.danger ? <AlertTriangle size={26} /> : <HelpCircle size={26} />
                ) : dialog.kind === 'alert' ? (
                  dialog.danger ? <AlertTriangle size={26} /> : <Info size={26} />
                ) : (
                  <HelpCircle size={26} />
                )}
              </div>

              <div>
                {dialog.title && <h3 className="font-black text-content">{dialog.title}</h3>}
                {dialog.description && (
                  <p className="text-xs text-content-muted font-bold mt-1.5 leading-relaxed">{dialog.description}</p>
                )}
              </div>

              {dialog.kind === 'prompt' && (
                <input
                  autoFocus
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  placeholder={dialog.placeholder}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') close(promptValue);
                    if (e.key === 'Escape') close(null);
                  }}
                  className="w-full px-4 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand outline-none font-bold text-content text-center"
                />
              )}

              <div className="flex gap-3">
                {dialog.kind === 'confirm' && (
                  <>
                    <button
                      onClick={() => close(true)}
                      className={cn(
                        "flex-1 text-white py-3 rounded-2xl font-black text-sm transition-all",
                        dialog.danger ? "bg-danger hover:bg-danger/90" : "bg-brand hover:bg-brand/90"
                      )}
                    >
                      {dialog.confirmLabel || t('common.confirm')}
                    </button>
                    <button
                      onClick={() => close(false)}
                      className="px-5 py-3 bg-surface-muted text-content-muted rounded-2xl font-black text-sm hover:bg-surface-muted/70 transition-all"
                    >
                      {dialog.cancelLabel || t('common.cancel')}
                    </button>
                  </>
                )}
                {dialog.kind === 'alert' && (
                  <button
                    onClick={() => close(undefined)}
                    className="w-full bg-brand text-white py-3 rounded-2xl font-black text-sm hover:bg-brand/90 transition-all"
                  >
                    {dialog.closeLabel || t('common.close')}
                  </button>
                )}
                {dialog.kind === 'prompt' && (
                  <>
                    <button
                      onClick={() => close(promptValue)}
                      className="flex-1 bg-brand text-white py-3 rounded-2xl font-black text-sm hover:bg-brand/90 transition-all"
                    >
                      {dialog.confirmLabel || t('common.confirm')}
                    </button>
                    <button
                      onClick={() => close(null)}
                      className="px-5 py-3 bg-surface-muted text-content-muted rounded-2xl font-black text-sm hover:bg-surface-muted/70 transition-all"
                    >
                      {dialog.cancelLabel || t('common.cancel')}
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context;
}
