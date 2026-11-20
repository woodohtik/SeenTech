import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, MapPin, Maximize2, Minimize2, SquarePen, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDirection } from '../../lib/direction';
import { AssistantMark, CatalogIcon, IconButton } from './parts';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { markdownToPlainText } from './markdown';
import { pageKeyForPath, suggestionsFor, type AssistantAccess } from './catalog';
import type { ChatMessage, ChatNotice, ChatProgress } from './types';
import { REMAINING_WARNING_AT } from './useAssistantChat';

export const PANEL_WIDTH = 440;
export const PANEL_WIDTH_EXPANDED = 640;

/** Subscribes to a media query; false where matchMedia does not exist. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function WelcomeScreen({
  userName, pathname, access, onAsk,
}: { userName?: string; pathname: string; access: AssistantAccess; onAsk: (text: string) => void }) {
  const { t } = useTranslation();
  const suggestions = suggestionsFor(pathname, access);
  const name = (userName || '').trim();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 pt-5 pb-4 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-[22px] leading-[1.3] font-extrabold text-content">
          {name ? t('ai.welcome_greeting', { name }) : t('ai.welcome_greeting_plain')}
        </h3>
        <p className="m-0 text-[15px] leading-[1.65] text-content-muted">{t('ai.welcome_intro')}</p>
      </div>

      <div className="self-start inline-flex items-center gap-2 h-9 px-3 rounded-full bg-surface-muted text-sm font-medium text-content">
        <MapPin size={18} className="shrink-0 text-content-muted" aria-hidden="true" />
        <span>{t('ai.you_are_in', { page: t(`ai.page.${pageKeyForPath(pathname)}`) })}</span>
      </div>

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-content-muted">{t('ai.try_asking')}</div>
          {suggestions.map((question) => (
            <button
              key={question.id}
              type="button"
              onClick={() => onAsk(t(question.textKey))}
              className="min-h-12 w-full flex items-center gap-3 px-4 py-2 rounded-[12px] bg-surface border border-border text-[15px] text-content text-start hover:border-content-muted/60 hover:bg-surface-muted"
            >
              <CatalogIcon name={question.icon} size={20} className="shrink-0 text-brand" />
              <span className="flex-1">{t(question.textKey)}</span>
              <ChevronLeft size={20} className="shrink-0 text-content-muted ltr:-scale-x-100" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface AssistantPanelProps {
  onClose: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  userName?: string;
  pathname: string;
  access: AssistantAccess;
  messages: ChatMessage[];
  isSending: boolean;
  progress: ChatProgress | null;
  notice: ChatNotice | null;
  announcement: string;
  input: string;
  onInputChange: (value: string) => void;
  onSend: (text?: string) => void;
  onStop: () => void;
  onRetry: () => void;
  onNewConversation: () => void;
  onStartTour: (topic: string) => void;
  /** Messages left today, or null when there is no limit. */
  remainingToday?: number | null;
}

/**
 * The assistant's container, in three shapes by width:
 *   under 640px   a bottom sheet over an ink-40% cover
 *   640-1279px    a side panel floating over the page, no cover
 *   1280px and up the same panel docked beside the page (Layout shifts the content)
 */
export function AssistantPanel(props: AssistantPanelProps) {
  const {
    onClose, expanded, onToggleExpanded, userName, pathname, access, messages, isSending, progress, notice,
    announcement, input, onInputChange, onSend, onStop, onRetry, onNewConversation, onStartTour, remainingToday,
  } = props;
  const { t } = useTranslation();
  const { dir, isRtl } = useDirection();
  const reduceMotion = useReducedMotion();
  const isPanel = useMediaQuery('(min-width: 640px)');
  const canExpand = useMediaQuery('(min-width: 1024px)');
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus goes into the question box when the assistant opens.
  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      // The bottom sheet is modal: Tab stays inside it. The side panel is not.
      if (e.key !== 'Tab' || isPanel || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!panelRef.current.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isPanel, onClose]);

  // Following a link inside the sheet leaves the page under it; close it. The side panel stays.
  const handleNavigate = () => { if (!isPanel) onClose(); };
  const handleAsk = (text: string) => { onSend(text); inputRef.current?.focus(); };

  const transition = reduceMotion ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] as const };
  // The panel sits on the side away from the sidebar: inline-end, which is the left in RTL.
  const offscreen = isPanel ? { x: isRtl ? '-100%' : '100%' } : { y: '100%' };
  const width = expanded && canExpand ? PANEL_WIDTH_EXPANDED : PANEL_WIDTH;
  // Out of messages: from a refusal just now, or from the counts read on opening.
  const limitMessage = notice?.kind === 'limit'
    ? (notice.message || t('ai.limit_strip'))
    : remainingToday === 0 ? t('ai.limit_strip') : null;
  const remainingNote = typeof remainingToday === 'number' && remainingToday > 0 && remainingToday <= REMAINING_WARNING_AT
    ? t('ai.remaining_today', { count: remainingToday })
    : null;

  return (
    <div dir={dir} className={cn("fixed z-50", isPanel ? "inset-y-0 end-0" : "inset-0")}>
      {!isPanel && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
          onClick={onClose}
          aria-hidden="true"
          className="absolute inset-0 bg-[rgba(14,42,66,0.4)]"
        />
      )}

      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal={!isPanel}
        aria-label={t('ai.name')}
        initial={offscreen}
        animate={{ x: 0, y: 0 }}
        exit={offscreen}
        transition={transition}
        style={isPanel ? { width, maxWidth: '100vw' } : undefined}
        className={cn(
          "bg-surface text-content flex flex-col font-sans",
          isPanel
            ? "h-full border-s border-border shadow-[0_12px_32px_rgba(14,42,66,.16),0_2px_6px_rgba(14,42,66,.08)] xl:shadow-none"
            : "absolute inset-x-0 bottom-0 h-[92dvh] rounded-t-[20px] shadow-[0_12px_32px_rgba(14,42,66,.16),0_2px_6px_rgba(14,42,66,.08)]"
        )}
      >
        {!isPanel && (
          <div aria-hidden="true" className="h-5 shrink-0 flex items-center justify-center">
            <span className="w-10 h-1 rounded-full bg-border" />
          </div>
        )}

        <header className={cn("shrink-0 flex items-center justify-between ps-4 pe-2 border-b border-border", isPanel ? "h-14" : "h-12")}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-8 h-8 shrink-0 rounded-[10px] bg-brand text-white flex items-center justify-center">
              <AssistantMark size={18} />
            </span>
            <h2 className="m-0 text-lg leading-[1.3] font-extrabold truncate">{t('ai.name')}</h2>
          </div>
          <div className="flex items-center shrink-0">
            <IconButton label={t('ai.new_conversation', 'محادثة جديدة')} onClick={onNewConversation} disabled={messages.length === 0 && !notice}>
              <SquarePen size={20} aria-hidden="true" />
            </IconButton>
            {canExpand && (
              <IconButton label={t(expanded ? 'ai.collapse' : 'ai.expand')} aria-pressed={expanded} onClick={onToggleExpanded}>
                {expanded ? <Minimize2 size={20} aria-hidden="true" /> : <Maximize2 size={20} aria-hidden="true" />}
              </IconButton>
            )}
            <IconButton label={t('ai.close')} onClick={onClose}>
              <X size={20} aria-hidden="true" />
            </IconButton>
          </div>
        </header>

        {messages.length === 0 && !notice ? (
          <WelcomeScreen userName={userName} pathname={pathname} access={access} onAsk={handleAsk} />
        ) : (
          <MessageList
            messages={messages}
            isSending={isSending}
            progress={progress}
            notice={notice}
            access={access}
            onAsk={handleAsk}
            onRetry={onRetry}
            onNavigate={handleNavigate}
            onStartTour={onStartTour}
          />
        )}

        <Composer
          value={input}
          onChange={onInputChange}
          onSend={() => onSend()}
          onStop={onStop}
          isSending={isSending}
          limitMessage={limitMessage}
          remainingNote={remainingNote}
          inputRef={inputRef}
        />

        {/* One announcement per finished reply, not one per streamed chunk. */}
        <div className="sr-only" role="status" aria-live="polite">
          {announcement ? t('ai.announce_reply', { text: markdownToPlainText(announcement) }) : ''}
        </div>
      </motion.div>
    </div>
  );
}
