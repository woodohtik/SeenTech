import React, { createContext, useContext, useState, useCallback, useEffect, lazy, Suspense, ReactNode } from 'react';
import { ConfirmStaticFrame } from './ConfirmFrame';
import { whenIdle } from '../lib/whenIdle';
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

// The dialog's animation (motion library) loads off the startup path: fetched
// when the browser is idle, mounted from the first dialog on (kept mounted so
// the closing animation plays). Until it is there -- or if it cannot load --
// the same dialog shows at once with a CSS enter (ConfirmFrame.tsx).
const loadConfirmMotionFrame = () => import('./ConfirmMotionFrame');
const ConfirmMotionFrame = lazy(() => loadConfirmMotionFrame().catch(() => ({ default: ConfirmStaticFrame })));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { dir, t } = useDirection();
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [frameMounted, setFrameMounted] = useState(false);

  useEffect(() => whenIdle(() => { loadConfirmMotionFrame().catch(() => {}); }), []);
  useEffect(() => { if (dialog) setFrameMounted(true); }, [dialog]);

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

  const onBackdrop = () => {
    if (!dialog) return;
    close(dialog.kind === 'confirm' ? false : dialog.kind === 'prompt' ? null : undefined);
  };

  const body = dialog && (
          <>
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
              className="w-full px-4 py-3 bg-surface border border-border rounded-xl outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand font-bold text-content text-center"
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
          </>
  );
  const frameProps = { open: !!dialog, dir, onBackdrop };

  return (
    <ConfirmContext.Provider value={{ confirm, alertModal, promptText }}>
      {children}
      {(frameMounted || dialog) && (
        <Suspense fallback={<ConfirmStaticFrame {...frameProps}>{body}</ConfirmStaticFrame>}>
          <ConfirmMotionFrame {...frameProps}>{body}</ConfirmMotionFrame>
        </Suspense>
      )}
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
