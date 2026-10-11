import React from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

const MAX_WIDTH = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
} as const;

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: keyof typeof MAX_WIDTH;
  panelClassName?: string;
  dir?: 'rtl' | 'ltr';
}

/**
 * سِين (seen-tablet-mobile-ux-review.md بند 3): لا يوجد مكوّن <Modal> مشترك
 * في المشروع -- كل نافذة تبني تعاملها الخاص مع الجوال من الصفر، فبعضها طبَّق
 * نمط ملء الشاشة/Bottom Sheet الصحيح (مثل "Add Customer Modal" في POS.tsx)
 * وبعضها نسيه. هذا المكوّن يستخرج نفس النمط المُثبَت عملياً هناك (Headless
 * UI Dialog/Transition، items-end sm:items-center، rounded-t-3xl sm:rounded-2xl)
 * إلى مكان واحد، للتطبيق التدريجي على النوافذ القديمة ولكل نافذة جديدة.
 */
export function Modal({ isOpen, onClose, title, children, footer, maxWidth = 'md', panelClassName, dir }: ModalProps) {
  const { i18n } = useTranslation();
  const resolvedDir = dir ?? (i18n.dir() as 'rtl' | 'ltr');

  return (
    <Transition appear show={isOpen} as={React.Fragment}>
      <Dialog as="div" className="relative z-[200]" onClose={onClose} dir={resolvedDir}>
        <Transition.Child
          as={React.Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-end sm:items-center justify-center sm:p-4 text-center">
            <Transition.Child
              as={React.Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-full sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-full sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel
                className={cn(
                  'w-full transform overflow-hidden rounded-t-3xl sm:rounded-3xl bg-surface shadow-2xl transition-all border border-border text-start max-h-[90vh] sm:max-h-[85vh] flex flex-col',
                  MAX_WIDTH[maxWidth],
                  panelClassName
                )}
              >
                {title && (
                  <div className="flex items-center justify-between gap-3 p-6 pb-4 border-b border-border shrink-0">
                    <Dialog.Title className="text-lg font-black text-content">{title}</Dialog.Title>
                    <button
                      type="button"
                      onClick={onClose}
                      aria-label="close"
                      className="p-2 -m-2 text-content-muted hover:text-content hover:bg-surface-muted rounded-full transition-colors shrink-0"
                    >
                      <X size={20} />
                    </button>
                  </div>
                )}
                <div className="p-6 overflow-y-auto">{children}</div>
                {footer && <div className="p-6 pt-4 border-t border-border shrink-0">{footer}</div>}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
