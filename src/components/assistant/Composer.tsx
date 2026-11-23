import React, { useId, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowUp, Square } from 'lucide-react';
import { cn } from '../../lib/utils';
import { VoiceMicButton } from '../ui/VoiceMicButton';

const MAX_LINES = 5;

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isSending: boolean;
  /** Set when today's message limit is reached: shown above the box, and typing stops. */
  limitMessage?: string | null;
  /** "Messages left today: 3", shown when few remain. */
  remainingNote?: string | null;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * The question box. Typing stays possible while a reply is coming (only
 * sending waits), so the field never loses focus between questions.
 */
export function Composer({ value, onChange, onSend, onStop, isSending, limitMessage, remainingNote, inputRef }: ComposerProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const isLimited = Boolean(limitMessage);
  const canSend = !isSending && !isLimited && value.trim().length > 0;

  // Grow with the text, up to five lines; beyond that the box scrolls.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 30;
    el.style.height = `${Math.min(el.scrollHeight, Math.round(lineHeight * MAX_LINES))}px`;
  }, [value, inputRef]);

  return (
    <footer className="shrink-0 px-4 pt-3 pb-[calc(0.875rem+env(safe-area-inset-bottom))] border-t border-border flex flex-col gap-2">
      {isLimited && (
        <div role="status" className="flex items-center gap-2 rounded-[12px] bg-warning/10 px-3 py-2.5 text-sm font-medium leading-normal text-content">
          <AlertTriangle size={20} className="shrink-0 text-warning" aria-hidden="true" />
          <span>{limitMessage}</span>
        </div>
      )}

      <div
        className={cn(
          "min-h-14 flex items-end gap-1 p-1 ps-4 rounded-[12px] border transition-colors",
          isLimited
            ? "bg-surface-muted border-border"
            : "bg-surface border-content-muted/60 focus-within:border-brand focus-within:outline focus-within:outline-1 focus-within:outline-brand"
        )}
      >
        <label htmlFor={inputId} className="sr-only">{t('ai.input_label')}</label>
        <textarea
          id={inputId}
          ref={inputRef}
          rows={1}
          value={value}
          disabled={isLimited}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter adds a line. Not while an IME is composing.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder={t(isLimited ? 'ai.input_placeholder_limit' : isSending ? 'ai.input_placeholder_busy' : 'ai.input_placeholder')}
          className="flex-1 min-w-0 min-h-12 self-center resize-none bg-transparent border-0 p-0 py-2 text-[15px] leading-[1.65] text-content placeholder:text-content-muted outline-none focus:ring-0 focus:outline-none disabled:text-content-muted"
        />

        {!isLimited && (
          <VoiceMicButton
            ariaLabel={t('ai.voice')}
            iconSize={20}
            className="shrink-0 w-12 h-12 flex items-center justify-center rounded-[12px] text-content-muted hover:bg-surface-muted hover:text-content"
            onResult={(text) => onChange([value, text].filter(Boolean).join(' '))}
          />
        )}

        {isSending ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={t('ai.stop')}
            title={t('ai.stop')}
            className="shrink-0 w-12 h-12 flex items-center justify-center rounded-[12px] bg-content text-surface hover:opacity-90"
          >
            <Square size={18} fill="currentColor" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            aria-label={t('ai.send')}
            title={t('ai.send')}
            className={cn(
              "shrink-0 w-12 h-12 flex items-center justify-center rounded-[12px] transition-colors",
              canSend ? "bg-brand text-white hover:bg-brand/90" : "bg-border text-content-muted"
            )}
          >
            <ArrowUp size={20} aria-hidden="true" />
          </button>
        )}
      </div>

      <p className="m-0 text-center text-sm leading-normal text-content-muted">
        {!isLimited && remainingNote && (
          <><span role="status" className="font-semibold text-warning">{remainingNote}</span>{' · '}</>
        )}
        {t('ai.disclaimer')}
      </p>
    </footer>
  );
}
