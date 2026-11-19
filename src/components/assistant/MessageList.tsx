import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Copy, LoaderCircle, RefreshCw } from 'lucide-react';
import { localeOf } from '../../lib/direction';
import { AssistantMark, IconButton, Markdown } from './parts';
import { ToolResultCard } from './DataCard';
import { TOOLS, followUpsFor, progressKeyFor, type AssistantAccess } from './catalog';
import { clockTime } from './formatters';
import { markdownToPlainText } from './markdown';
import type { ChatMessage, ChatNotice, ChatProgress } from './types';

/** A line from the system inside the conversation: what went wrong and what to do now. */
function SystemLine({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="status" className="rounded-[12px] bg-warning/10 p-4 flex flex-col gap-3">
      <div className="flex gap-3 text-warning">
        <AlertTriangle size={24} className="shrink-0 mt-0.5" aria-hidden="true" />
        <span className="text-lg font-medium text-content">{text}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="self-start min-h-12 px-5 inline-flex items-center gap-2 rounded-[12px] bg-surface border border-content-muted/60 text-lg font-semibold text-content hover:bg-surface-muted"
        >
          <RefreshCw size={20} aria-hidden="true" />
          <span>{t('common.retry', 'إعادة المحاولة')}</span>
        </button>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access (an insecure origin, or a denied permission): nothing to show.
    }
  };

  return (
    <IconButton size={44} label={copied ? t('ai.copied') : t('ai.copy_answer')} onClick={copy}>
      {copied ? <Check size={20} aria-hidden="true" /> : <Copy size={20} aria-hidden="true" />}
    </IconButton>
  );
}

function AssistantReply({
  message, isStreaming, access, onNavigate, onStartTour,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  access: AssistantAccess;
  onNavigate: () => void;
  onStartTour: (topic: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const results = message.toolResults || [];
  const hasShopData = results.some((r) => r.name !== 'guidedTour' && r.result && !r.result.denied);
  const isDone = !isStreaming && typeof message.at === 'number';

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2 text-base font-semibold text-content-muted">
        <span className="w-6 h-6 rounded-[6px] bg-brand text-white flex items-center justify-center">
          <AssistantMark size={15} />
        </span>
        <span>{t('ai.reply_label')}</span>
      </div>

      {message.content && <Markdown source={message.content} onNavigate={onNavigate} />}

      {results.map((tr, i) => (
        <ToolResultCard key={i} name={tr.name} result={tr.result} access={access} onNavigate={onNavigate} onStartTour={onStartTour} />
      ))}

      {(message.toolErrors || []).map((toolName, i) => (
        <SystemLine
          key={`err-${i}`}
          text={TOOLS[toolName] ? t('ai.tool_error', { what: t(TOOLS[toolName].titleKey) }) : t('ai.tool_error_generic')}
        />
      ))}

      {isDone && (message.content || hasShopData) && (
        <div className="flex items-center justify-between gap-2 min-h-11">
          <span className="text-base text-content-muted">
            {hasShopData && t('ai.source_line', { time: t('ai.day.until', { time: clockTime(message.at!, localeOf(i18n.language)) }) })}
          </span>
          {message.content && <CopyButton text={markdownToPlainText(message.content)} />}
        </div>
      )}
    </div>
  );
}

export interface MessageListProps {
  messages: ChatMessage[];
  isSending: boolean;
  progress: ChatProgress | null;
  notice: ChatNotice | null;
  access: AssistantAccess;
  onAsk: (text: string) => void;
  onRetry: () => void;
  onNavigate: () => void;
  onStartTour: (topic: string) => void;
}

export function MessageList({
  messages, isSending, progress, notice, access, onAsk, onRetry, onNavigate, onStartTour,
}: MessageListProps) {
  const { t } = useTranslation();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lastUserRef = useRef<HTMLDivElement>(null);
  // Follow the end of a reply only when the reader has scrolled down to it themselves.
  const followRef = useRef(false);
  const programmaticRef = useRef(false);

  const lastUserIndex = messages.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
  const userCount = messages.filter((m) => m.role === 'user').length;

  // A new question: bring it to the top once, so the start of the reply is
  // what the reader sees. The view then stays put while the reply grows.
  useLayoutEffect(() => {
    if (userCount === 0) return;
    followRef.current = false;
    programmaticRef.current = true;
    lastUserRef.current?.scrollIntoView({ block: 'start' });
    window.setTimeout(() => { programmaticRef.current = false; }, 80);
  }, [userCount]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !followRef.current) return;
    programmaticRef.current = true;
    el.scrollTop = el.scrollHeight;
    window.setTimeout(() => { programmaticRef.current = false; }, 80);
  }, [messages, progress, notice]);

  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el || programmaticRef.current) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const last = messages[messages.length - 1];
  const followUps = !isSending && !notice && last?.role === 'assistant' ? followUpsFor(last.toolResults, access) : [];

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      role="log"
      aria-label={t('ai.conversation_label')}
      // Announced once, when a reply is complete (the live region in the panel), not on every chunk.
      aria-live="off"
      className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 pt-5 pb-3 flex flex-col gap-4"
    >
      {messages.map((m, i) => {
        if (m.role === 'user') {
          return (
            // رسائل المستخدم دائماً في اليمين الفعلي للشاشة (كما في واتساب/تيليجرام)
            // بغض النظر عن اتجاه الصفحة — لذا تُعكس المحاذاة في rtl.
            <div
              key={i}
              ref={i === lastUserIndex ? lastUserRef : undefined}
              className="self-end rtl:self-start max-w-[85%] rounded-[12px] bg-surface-muted px-4 py-2.5 text-lg leading-[1.7] text-content whitespace-pre-wrap break-words scroll-mt-5"
            >
              {m.content}
            </div>
          );
        }
        return (
          <AssistantReply
            key={i}
            message={m}
            isStreaming={isSending && i === messages.length - 1}
            access={access}
            onNavigate={onNavigate}
            onStartTour={onStartTour}
          />
        );
      })}

      {isSending && progress && (
        <div role="status" className="flex items-center gap-3 text-lg font-medium text-content">
          <LoaderCircle size={24} className="shrink-0 text-brand animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <span>{t(progressKeyFor(progress.tool))}</span>
        </div>
      )}

      {notice && notice.kind !== 'limit' && (
        notice.kind === 'cancelled'
          ? <p role="status" className="m-0 text-base text-content-muted">{notice.message}</p>
          : <SystemLine text={notice.message} onRetry={notice.canRetry ? onRetry : undefined} />
      )}

      {followUps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {followUps.map((question) => (
            <button
              key={question.id}
              type="button"
              onClick={() => onAsk(t(question.textKey))}
              className="min-h-11 px-4 rounded-full bg-surface border border-content-muted/60 text-base font-medium text-content hover:bg-surface-muted"
            >
              {t(question.shortKey || question.textKey)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
