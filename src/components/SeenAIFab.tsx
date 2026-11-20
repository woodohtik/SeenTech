import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { startTargetedTour } from './OnboardingTour';
import { AssistantMark } from './assistant/parts';
import { AssistantPanel, PANEL_WIDTH, PANEL_WIDTH_EXPANDED, useMediaQuery } from './assistant/AssistantPanel';
import { isAssistantAdminRole, pageKeyForPath, type AssistantAccess } from './assistant/catalog';
import { useAssistantChat, useAssistantStatus } from './assistant/useAssistantChat';

interface SeenAIFabProps {
  userName?: string;
  userRole?: string;
  tenantId?: string | null;
  /** The app's permission check, so suggestions match what this person may ask. */
  can?: (permission: string) => boolean;
}

const EXPANDED_KEY = 'seen_ai_panel_expanded';
/** Read by Layout's root: the width the docked panel takes from the page at 1280px and up. */
const DOCK_VAR = '--assistant-dock';

function readExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The assistant: a launcher in the corner and the panel it opens. The pieces
 * live in ./assistant; this file only holds what is open and wires them.
 */
export default function SeenAIFab({ userName, userRole, tenantId, can }: SeenAIFabProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const status = useAssistantStatus(tenantId);
  const [isOpen, setIsOpen] = useState(false);
  const [expanded, setExpanded] = useState(readExpanded);
  const [input, setInput] = useState('');
  const launcherRef = useRef<HTMLButtonElement>(null);
  const isDocked = useMediaQuery('(min-width: 1280px)');

  const close = useCallback(() => {
    setIsOpen(false);
    // Focus returns to where it came from.
    window.setTimeout(() => launcherRef.current?.focus(), 0);
  }, []);

  const launchGuidedTour = useCallback((topic: string) => {
    setIsOpen(false);
    window.setTimeout(() => startTargetedTour(topic), 300);
  }, []);

  const chat = useAssistantChat({ tenantId, userName, userRole, page: pageKeyForPath(pathname), onTourRequested: launchGuidedTour });

  const access = useMemo<AssistantAccess>(() => ({
    isAdmin: isAssistantAdminRole(userRole),
    can: (permission) => (can ? can(permission) : false),
  }), [userRole, can]);

  const toggleExpanded = useCallback(() => {
    setExpanded((value) => {
      try {
        localStorage.setItem(EXPANDED_KEY, value ? '0' : '1');
      } catch {
        // No storage (private window): the choice lasts for this visit only.
      }
      return !value;
    });
  }, []);

  // At 1280px and up the panel sits beside the page instead of over it.
  useEffect(() => {
    const root = document.documentElement;
    if (isOpen && isDocked) root.style.setProperty(DOCK_VAR, `${expanded ? PANEL_WIDTH_EXPANDED : PANEL_WIDTH}px`);
    else root.style.removeProperty(DOCK_VAR);
    return () => { root.style.removeProperty(DOCK_VAR); };
  }, [isOpen, isDocked, expanded]);

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
          onClick={() => setIsOpen(true)}
          aria-label={t('ai.launcher')}
          aria-haspopup="dialog"
          className="h-14 min-w-14 px-0 sm:ps-5 sm:pe-6 inline-flex items-center justify-center gap-2.5 rounded-[12px] bg-brand text-white text-[15px] font-semibold shadow-[0_2px_8px_rgba(14,42,66,.08),0_1px_2px_rgba(14,42,66,.06)] hover:bg-brand/90"
        >
          <AssistantMark size={24} className="sm:w-6 sm:h-6 w-[26px] h-[26px]" />
          <span className="hidden sm:inline">{t('ai.launcher')}</span>
        </button>
      )}

      <AnimatePresence>
        {isOpen && (
          <AssistantPanel
            onClose={close}
            expanded={expanded}
            onToggleExpanded={toggleExpanded}
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
          />
        )}
      </AnimatePresence>
    </>
  );
}
