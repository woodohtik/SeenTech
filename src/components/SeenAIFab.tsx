import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantMode } from '../lib/shellLayout';
import { AnimatePresence } from 'motion/react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { startTargetedTour } from '../lib/tourEvents';
import { AssistantMark } from './assistant/parts';
import { AssistantPanel } from './assistant/AssistantPanel';
import { isAssistantAdminRole, pageKeyForPath, type AssistantAccess } from './assistant/catalog';
import { useAssistantChat, useAssistantStatus } from './assistant/useAssistantChat';

interface SeenAIFabProps {
  /**
   * Where the assistant sits, decided by the shell (lib/shellLayout.ts):
   * beside the page, over it, or as a bottom sheet. The shell owns "open" and
   * "wide" as well, because the sidebar's fold depends on them.
   */
  mode: AssistantMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  userName?: string;
  userRole?: string;
  tenantId?: string | null;
  /** The app's permission check, so suggestions match what this person may ask. */
  can?: (permission: string) => boolean;
}

/**
 * The assistant: a launcher in the corner and the panel it opens. The pieces
 * live in ./assistant; this file only holds what is open and wires them.
 */
export default function SeenAIFab({ mode, open: isOpen, onOpenChange, expanded, onToggleExpanded, userName, userRole, tenantId, can }: SeenAIFabProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const status = useAssistantStatus(tenantId);
  const [input, setInput] = useState('');
  const launcherRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    onOpenChange(false);
    // Focus returns to where it came from.
    window.setTimeout(() => launcherRef.current?.focus(), 0);
  }, [onOpenChange]);

  const launchGuidedTour = useCallback((topic: string) => {
    onOpenChange(false);
    window.setTimeout(() => startTargetedTour(topic), 300);
  }, [onOpenChange]);

  const chat = useAssistantChat({ tenantId, userName, userRole, page: pageKeyForPath(pathname), onTourRequested: launchGuidedTour });

  const access = useMemo<AssistantAccess>(() => ({
    isAdmin: isAssistantAdminRole(userRole),
    can: (permission) => (can ? can(permission) : false),
  }), [userRole, can]);

  // The counts change with every message: re-read them when the panel opens
  // and when a reply (or a refusal) finishes.
  const { refresh } = status;
  const wasSending = useRef(false);
  useEffect(() => {
    if (wasSending.current && !chat.isSending) refresh();
    wasSending.current = chat.isSending;
  }, [chat.isSending, refresh]);
  useEffect(() => { if (isOpen) refresh(); }, [isOpen, refresh]);

  const send = useCallback((text?: string) => {
    if (chat.sendMessage(text ?? input) && text === undefined) setInput('');
  }, [chat, input]);

  if (!status.isEnabled) return null;

  return (
    <>
      {!isOpen && (
        <button
          ref={launcherRef}
          type="button"
          id="tour-ai-fab"
          data-tour="ai-fab"
          onClick={() => onOpenChange(true)}
          aria-label={t('ai.launcher')}
          aria-haspopup="dialog"
          title={t('ai.launcher')}
          // Icon only, at every width (founder, 2026-11-20); the name stays
          // for screen readers and as the hover tooltip.
          // Smaller on a phone, where it sat over cards and lists (phase 4).
          className="w-12 h-12 lg:w-14 lg:h-14 inline-flex items-center justify-center rounded-[12px] bg-brand text-white shadow-[0_2px_8px_rgba(14,42,66,.08),0_1px_2px_rgba(14,42,66,.06)] hover:bg-brand/90"
        >
          <AssistantMark size={26} />
        </button>
      )}

      <AnimatePresence>
        {isOpen && mode !== 'closed' && (
          <AssistantPanel
            mode={mode}
            onClose={close}
            expanded={expanded}
            onToggleExpanded={onToggleExpanded}
            userName={userName}
            pathname={pathname}
            access={access}
            messages={chat.messages}
            isSending={chat.isSending}
            progress={chat.progress}
            notice={chat.notice}
            announcement={chat.announcement}
            input={input}
            onInputChange={setInput}
            onSend={send}
            onStop={chat.cancel}
            onRetry={chat.retry}
            onNewConversation={chat.startNewConversation}
            onStartTour={launchGuidedTour}
            remainingToday={status.remaining}
            onRate={chat.rate}
            onCloseRating={chat.closeRating}
            conversationId={chat.conversationId}
            onListConversations={chat.listConversations}
            onOpenConversation={chat.openConversation}
            onDeleteConversation={chat.deleteConversation}
          />
        )}
      </AnimatePresence>
    </>
  );
}
