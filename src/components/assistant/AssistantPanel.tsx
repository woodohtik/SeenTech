import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, History, MapPin, Maximize2, Minimize2, SquarePen, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDirection } from '../../lib/direction';
import { AssistantMark, CatalogIcon, IconButton } from './parts';
import { Composer } from './Composer';
import { MessageList, type RateReply } from './MessageList';
import { HistoryView } from './HistoryView';
import type { ConversationSummary } from './useAssistantChat';
import { markdownToPlainText } from './markdown';
import { pageKeyForPath, suggestionsFor, type AssistantAccess } from './catalog';
import type { ChatMessage, ChatNotice, ChatProgress } from './types';
import { REMAINING_WARNING_AT } from './useAssistantChat';
import { assistantWidthCss } from '../../lib/shellLayout';

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
  /** Decided by the shell from the window's width (lib/shellLayout.ts). */
  mode: 'sheet' | 'overlay' | 'docked';
  onClose: () => void;
  /** Already false where the wide size is not offered. */
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
  onRate: RateReply;
  onCloseRating: (id: string) => void;
  conversationId: string;
  onListConversations: () => Promise<ConversationSummary[]>;
  onOpenConversation: (id: string) => Promise<void>;
  onDeleteConversation: (id: string) => Promise<void>;
}

/**
 * The assistant's container, in three shapes (seen-responsive-layout-task.md Phase 1):
 *   sheet    under 640px: a bottom sheet over an ink-40% cover
 *   overlay  a side panel over the page and a cover, where sitting beside the
 *            page would leave it under 960px -- the page keeps its width
 *   docked   the same panel beside the page; Layout gives it the room
 * The sheet and the overlay are modal (cover, Tab kept inside, Escape and a
 * press on the cover close them); the docked panel is not -- the page beside
 * it stays in use.
 */
export function AssistantPanel(props: AssistantPanelProps) {
  const {
    mode, onClose, expanded, onToggleExpanded, userName, pathname, access, messages, isSending, progress, notice,
    announcement, input, onInputChange, onSend, onStop, onRetry, onNewConversation, onStartTour, remainingToday, onRate, onCloseRating,
    conversationId, onListConversations, onOpenConversation, onDeleteConversation,
  } = props;
  const [showHistory, setShowHistory] = useState(false);
  const { t } = useTranslation();
  const { dir, isRtl } = useDirection();
  const reduceMotion = useReducedMotion();
  const isPanel = mode !== 'sheet';
  const isModal = mode !== 'docked';
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
        // Docked beside the page, Escape pressed in the page (a window open
        // there) is the page's: leave it to close that window.
        if (!isModal && panelRef.current && !panelRef.current.contains(e.target as Node)) return;
        e.stopPropagation();
        onClose();
        return;
      }
      // Modal (sheet, overlay): Tab stays inside. Beside the page it does not.
      if (e.key !== 'Tab' || !isModal || !panelRef.current) return;
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
  }, [isModal, onClose]);

  // Following a link while the assistant covers the page: close it, so the page shows. Docked, it stays.
  const handleNavigate = () => { if (isModal) onClose(); };
  const handleAsk = (text: string) => { onSend(text); inputRef.current?.focus(); };

  const transition = reduceMotion ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] as const };
  // The panel sits on the side away from the sidebar: inline-end, which is the left in RTL.
  const offscreen = isPanel ? { x: isRtl ? '-100%' : '100%' } : { y: '100%' };
  const width = assistantWidthCss(expanded);
  // Out of messages: from a refusal just now, or from the counts read on opening.
  const limitMessage = notice?.kind === 'limit'
    ? (notice.message || t('ai.limit_strip'))
    : remainingToday === 0 ? t('ai.limit_strip') : null;
  const remainingNote = typeof remainingToday === 'number' && remainingToday > 0 && remainingToday <= REMAINING_WARNING_AT
    ? t('ai.remaining_today', { count: remainingToday })
    : null;

  return (
    <div dir={dir} data-assistant-mode={mode} className={cn("fixed z-50", isModal ? "inset-0" : "inset-y-0 end-0")}>
      {isModal && (
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
        aria-modal={isModal}
        aria-label={t('ai.name')}
        initial={offscreen}
        animate={{ x: 0, y: 0 }}
        exit={offscreen}
        transition={transition}
        style={isPanel ? { width, maxWidth: '100vw' } : undefined}
        className={cn(
          "bg-surface text-content flex flex-col font-sans",
          isPanel
            ? cn("h-full border-s border-border", mode === 'overlay' && "absolute inset-y-0 end-0 shadow-[0_12px_32px_rgba(14,42,66,.16),0_2px_6px_rgba(14,42,66,.08)]")
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
            <IconButton
              label={t('ai.history')}
              aria-pressed={showHistory}
              onClick={() => setShowHistory((v) => !v)}
              className={cn(showHistory && 'text-brand bg-brand/10 hover:text-brand')}
            >
              <History size={20} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={t('ai.new_conversation', 'محادثة جديدة')}
              onClick={() => { onNewConversation(); setShowHistory(false); }}
              disabled={messages.length === 0 && !notice && !showHistory}
            >
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

        {showHistory ? (
          <HistoryView
            currentId={conversationId}
            onList={onListConversations}
            onOpen={onOpenConversation}
            onDelete={onDeleteConversation}
            onDone={() => { setShowHistory(false); inputRef.current?.focus(); }}
          />
        ) : messages.length === 0 && !notice ? (
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
            onRate={onRate}
            onCloseRating={onCloseRating}
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
