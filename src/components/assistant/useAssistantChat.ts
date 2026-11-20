import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase/client';
import type { ChatMessage, ChatNotice, ChatProgress, ToolResult } from './types';

// seen-ai-assistant-zatca-cr-task.md #1: مهلة زمنية قصوى لطلب الدردشة --
// بدونها، أي تعلّق في الخادم (مزوّد لا يرجع خطأ صريح) يُبقي الواجهة في وضع
// الانتظار للأبد بلا أي وسيلة خروج غير تحديث الصفحة بالكامل.
const REQUEST_TIMEOUT_MS = 40_000;

// #3: يُرسَل آخر هذا العدد من الرسائل فقط مع كل طلب، لا السجل كاملاً --
// يحد استهلاك التوكنات/التكلفة مع طول المحادثة بدل أن يكبر بلا حدود. السجل
// المعروض محلياً للمستخدم يبقى كاملاً، هذا يحد فقط ما يُرسَل فعلياً للخادم.
const MAX_HISTORY_MESSAGES = 20;

function chatStorageKey(tenantId: string): string {
  return `seen_ai_chat_${tenantId}`;
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface AssistantStatus {
  isEnabled: boolean;
  /** Messages left today; null when there is no daily limit or it is unknown. */
  remaining: number | null;
  dailyLimit: number | null;
}

/** Below this many messages left, the box says how many remain. */
export const REMAINING_WARNING_AT = 5;

/**
 * Whether the assistant is switched on for this shop, and how many messages
 * are left today (/api/assistant-settings/status). `refresh` re-reads it,
 * after each reply and whenever the panel opens.
 */
export function useAssistantStatus(tenantId: string | null | undefined): AssistantStatus & { refresh: () => void } {
  const [status, setStatus] = useState<AssistantStatus>({ isEnabled: false, remaining: null, dailyLimit: null });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tenantId) return;
      try {
        const authHeader = await getAuthHeader();
        if (!authHeader.Authorization) return;
        const res = await fetch('/api/assistant-settings/status', { headers: authHeader });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setStatus({
          isEnabled: Boolean(data.isEnabled),
          remaining: typeof data.remaining === 'number' ? data.remaining : null,
          dailyLimit: typeof data.dailyLimit === 'number' ? data.dailyLimit : null,
        });
      } catch {
        // fail silently — no assistant button is a safe default, and a
        // failed refresh keeps the last known counts
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, tick]);

  return { ...status, refresh };
}

interface UseAssistantChatOptions {
  tenantId?: string | null;
  userName?: string;
  userRole?: string;
  /** The page key (catalog.pageKeyForPath) sent so the model knows where the person is. */
  page?: string;
  /** A reply finished and asked for a guided tour to start (the user agreed in words). */
  onTourRequested: (topic: string) => void;
}

/**
 * The conversation with /api/chat: sending, the NDJSON stream, cancel, retry,
 * and keeping the conversation across a page refresh. No markup lives here.
 *
 * Unchanged from the previous assistant: the 40s timeout, the 20-message
 * window, cancel and retry on one AbortController, sessionStorage, and what
 * 403 / 429 / 503 mean.
 */
export function useAssistantChat({ tenantId, userName, userRole, page, onTourRequested }: UseAssistantChatOptions) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState<ChatProgress | null>(null);
  const [notice, setNotice] = useState<ChatNotice | null>(null);
  /** The text of the reply that just finished, for the screen reader. Set once per reply. */
  const [announcement, setAnnouncement] = useState('');

  const abortControllerRef = useRef<AbortController | null>(null);
  const manualCancelRef = useRef(false);
  const lastRequestMessagesRef = useRef<ChatMessage[] | null>(null);
  const hydratedTenantRef = useRef<string | null>(null);
  const pendingTourTopicRef = useRef<string | null>(null);

  // #2: استرجاع المحادثة من sessionStorage عند توفر tenantId -- مرة واحدة
  // فقط لكل تبويب/جلسة متصفح، لا localStorage (لا داعٍ لبقاء المحادثة بعد
  // إغلاق المتصفح، وsessionStorage يعزل تلقائياً بين تبويبات/مستخدمين
  // مختلفين على نفس الجهاز بلا أي منطق إضافي).
  useEffect(() => {
    if (!tenantId || hydratedTenantRef.current === tenantId) return;
    hydratedTenantRef.current = tenantId;
    try {
      const raw = sessionStorage.getItem(chatStorageKey(tenantId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
      }
    } catch {
      // تخزين تالف أو غير متاح (وضع التصفح الخاص) -- يبدأ بمحادثة فارغة فقط
    }
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    try {
      if (messages.length === 0) sessionStorage.removeItem(chatStorageKey(tenantId));
      else sessionStorage.setItem(chatStorageKey(tenantId), JSON.stringify(messages));
    } catch {
      // مساحة التخزين ممتلئة أو غير متاحة -- المحادثة ببساطة لن تنجو من تحديث الصفحة
    }
  }, [messages, tenantId]);

  // استُخرجت من sendMessage لتُستدعى أيضاً من زر "إعادة المحاولة" (#7) بنفس
  // requestMessages الفاشلة تماماً دون إضافة رسالة مستخدم مكررة.
  const performRequest = useCallback(async (requestMessages: ChatMessage[]) => {
    setIsSending(true);
    setProgress({ tool: null });
    setNotice(null);
    manualCancelRef.current = false;

    // #1: مهلة زمنية قصوى + إمكانية إلغاء يدوي (cancel أدناه) عبر نفس
    // AbortController -- كلاهما يصل لنفس catch، يُفرَّقان عبر manualCancelRef.
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let startedReply = false;
    let textAcc = '';
    let afterTool = false;
    const toolResultsAcc: ToolResult[] = [];
    const toolErrorsAcc: string[] = [];

    // The last message is the reply being written; replace it with the latest snapshot.
    const writeReply = (extra: Partial<ChatMessage> = {}) => {
      const snapshot: ChatMessage = {
        role: 'assistant',
        content: textAcc,
        toolResults: [...toolResultsAcc],
        ...(toolErrorsAcc.length ? { toolErrors: [...toolErrorsAcc] } : {}),
        ...extra,
      };
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = snapshot;
        return copy;
      });
    };

    try {
      const authHeader = await getAuthHeader();
      if (!authHeader.Authorization) throw new Error('no_session');

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          // Only what the server reads; the local-only fields stay here.
          messages: requestMessages.slice(-MAX_HISTORY_MESSAGES).map(({ role, content, toolResults }) => ({ role, content, toolResults })),
          userName,
          userRole,
          page,
        }),
        signal: controller.signal,
      });

      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        // Stays on screen until the user closes the panel: it used to close
        // itself after 2.5s, before the reason could be read.
        setNotice({ kind: 'disabled', message: data.message || t('ai.assistant_disabled_message'), canRetry: false });
        return;
      }
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setNotice({ kind: 'limit', message: data.message || t('ai.daily_limit_reached'), canRetry: false });
        return;
      }
      if (res.status === 503) {
        const data = await res.json().catch(() => ({}));
        setNotice({ kind: 'not_configured', message: data.message || t('ai.not_configured_message'), canRetry: false });
        return;
      }
      if (!res.ok || !res.body) throw new Error('request_failed');

      setMessages((prev) => [...prev, { role: 'assistant', content: '', toolResults: [] }]);
      startedReply = true;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';
      pendingTourTopicRef.current = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || ''; // آخر سطر قد يكون غير مكتمل بعد
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const part = JSON.parse(line);
            if (part.t === 'text') {
              // The words themselves now show the work; the progress line goes.
              setProgress(null);
              // Text written after a tool call is a new paragraph, not a
              // continuation of the sentence before the call.
              if (afterTool && textAcc && !/\s$/.test(textAcc) && !/^\s/.test(part.v)) textAcc += '\n\n';
              afterTool = false;
              textAcc += part.v;
            } else if (part.t === 'status') {
              setProgress({ tool: typeof part.name === 'string' ? part.name : null });
            } else if (part.t === 'tool') {
              afterTool = true;
              toolResultsAcc.push({ name: part.name, result: part.result });
              if (part.name === 'guidedTour' && part.result?.action === 'start' && part.result?.topic) {
                pendingTourTopicRef.current = part.result.topic;
              }
            } else if (part.t === 'tool-error') {
              afterTool = true;
              toolErrorsAcc.push(typeof part.name === 'string' ? part.name : '');
            }
          } catch {
            // سطر NDJSON غير صالح (نادر) — تجاهله بدل كسر المحادثة كاملة
          }
        }
        writeReply();
      }

      writeReply({ at: Date.now() });
      setAnnouncement(textAcc);
      try {
        navigator.vibrate?.(40);
      } catch {
        // اهتزاز غير مدعوم (سطح المكتب غالباً) -- تجاهل
      }

      // المستخدم وافق نصياً على جولة تعليمية عُرضت سابقاً — بعد اكتمال رد
      // المساعد كاملاً (النص الختامي مرئي أولاً)، ابدأ الجولة على الموضوع المطلوب.
      if (pendingTourTopicRef.current) {
        const topic = pendingTourTopicRef.current;
        pendingTourTopicRef.current = null;
        window.setTimeout(() => onTourRequested(topic), 500);
      }
    } catch (err: any) {
      // What already arrived is kept and marked finished, so it can be read and copied.
      if (startedReply && (textAcc || toolResultsAcc.length)) writeReply({ at: Date.now() });
      else if (startedReply) setMessages((prev) => prev.slice(0, -1));

      if (err?.name === 'AbortError') {
        if (manualCancelRef.current) {
          setNotice({ kind: 'cancelled', message: t('ai.request_cancelled'), canRetry: false });
        } else {
          lastRequestMessagesRef.current = requestMessages;
          setNotice({ kind: 'timeout', message: t('ai.request_timeout'), canRetry: true });
        }
      } else {
        console.error('SeenAI chat error:', err);
        lastRequestMessagesRef.current = requestMessages;
        setNotice({ kind: 'error', message: t('ai.error_generic'), canRetry: true });
      }
    } finally {
      window.clearTimeout(timeoutId);
      abortControllerRef.current = null;
      setIsSending(false);
      setProgress(null);
    }
  }, [userName, userRole, page, t, onTourRequested]);

  /** Sends a new question. Returns false when there is nothing to send or a reply is still coming. */
  const sendMessage = useCallback((text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return false;
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    void performRequest(nextMessages);
    return true;
  }, [isSending, messages, performRequest]);

  // #1: إيقاف يدوي -- يستخدم نفس AbortController الخاص بالمهلة الزمنية.
  const cancel = useCallback(() => {
    manualCancelRef.current = true;
    abortControllerRef.current?.abort();
  }, []);

  // #7: إعادة محاولة بنفس requestMessages الفاشلة تماماً -- لا عبر sendMessage
  // (التي كانت ستُلحق رسالة مستخدم مكررة فوق الرسالة الفاشلة الموجودة أصلاً).
  // الرد الناقص من المحاولة الفاشلة يُزال أولاً حتى لا يبقى مع الرد الجديد.
  const retry = useCallback(() => {
    const request = lastRequestMessagesRef.current;
    if (!request) return;
    setMessages(request);
    void performRequest(request);
  }, [performRequest]);

  const startNewConversation = useCallback(() => {
    setMessages([]);
    setNotice(null);
    setAnnouncement('');
    lastRequestMessagesRef.current = null;
  }, []);

  return { messages, isSending, progress, notice, announcement, sendMessage, cancel, retry, startNewConversation };
}
