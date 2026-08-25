import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, Sparkles, X, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useDirection } from '../lib/direction';
import { supabase } from '../lib/supabase/client';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SeenAIFabProps {
  userName?: string;
  userRole?: string;
  tenantId?: string | null;
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function SeenAIFab({ userName, userRole, tenantId }: SeenAIFabProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const { t } = useTranslation();
  const { dir, isRtl } = useDirection();
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
        if (!cancelled) setIsEnabled(Boolean(data.isEnabled));
      } catch {
        // fail silently — no assistant button is a safe default
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isSending) return;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setIsSending(true);
    setBannerMessage(null);

    try {
      const authHeader = await getAuthHeader();
      if (!authHeader.Authorization) throw new Error('no_session');

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ messages: nextMessages, userName, userRole }),
      });

      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        setBannerMessage(data.message || t('ai.assistant_disabled_message'));
        setIsSending(false);
        setTimeout(() => setIsOpen(false), 2500);
        return;
      }
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setBannerMessage(data.message || t('ai.daily_limit_reached'));
        setIsSending(false);
        return;
      }
      if (res.status === 503) {
        const data = await res.json().catch(() => ({}));
        setBannerMessage(data.message || t('ai.not_configured_message'));
        setIsSending(false);
        return;
      }
      if (!res.ok || !res.body) {
        throw new Error('request_failed');
      }

      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const snapshot = acc;
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: snapshot };
          return copy;
        });
      }
    } catch (err) {
      console.error('SeenAI chat error:', err);
      setBannerMessage(t('ai.error_generic'));
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, messages, userName, userRole, t]);

  if (!isEnabled) return null;

  return (
    <>
      <div id="tour-ai-fab" data-tour="ai-fab" className={`fixed bottom-6 ${isRtl ? 'left-6' : 'right-6'} z-50 flex flex-col items-center gap-2`}>
        <button
          onClick={() => setIsOpen(true)}
          className="w-14 h-14 bg-brand rounded-2xl shadow-lg flex items-center justify-center text-white hover:shadow-xl hover:scale-105 transition-all relative group"
        >
          <Sparkles className="absolute top-2 right-2 w-3 h-3 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity" />
          <Bot size={28} />
        </button>
      </div>

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm" dir={dir}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface w-full h-[85vh] sm:h-[600px] sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden relative border border-border flex flex-col"
            >
              <div className="p-4 border-b border-border flex justify-between items-center bg-brand/5 dark:bg-brand/10 shrink-0">
                <h2 className="text-lg font-bold text-content flex items-center gap-2">
                  <Bot className="text-brand" size={22} /> {t('ai.assistant_title')}
                </h2>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 hover:bg-black/5 rounded-full text-content-muted transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && !bannerMessage && (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-4">
                    <div className="w-16 h-16 bg-brand/10 rounded-full flex items-center justify-center">
                      <Bot size={32} className="text-brand" />
                    </div>
                    <p className="text-content-muted font-bold text-sm">
                      {t('ai.empty_state_greeting', { name: userName || '' })}
                    </p>
                  </div>
                )}

                {/* رسائل المستخدم دائماً في اليمين الفعلي للشاشة (كما في واتساب/تيليجرام)
                    بغض النظر عن اتجاه الصفحة — لذا نعكس justify-end/start عبر rtl: */}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end rtl:justify-start' : 'justify-start rtl:justify-end'}`}>
                    <div
                      className={
                        m.role === 'user'
                          ? 'max-w-[80%] bg-brand text-white rounded-2xl rounded-tr-md px-4 py-2.5 text-sm font-medium whitespace-pre-wrap'
                          : 'max-w-[80%] bg-surface-muted text-content rounded-2xl rounded-tl-md px-4 py-2.5 text-sm font-medium whitespace-pre-wrap'
                      }
                    >
                      {m.content}
                    </div>
                  </div>
                ))}

                {isSending && !messages[messages.length - 1]?.content && (
                  <div className="flex justify-start rtl:justify-end">
                    <div className="bg-surface-muted rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 bg-content-muted rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1.5 h-1.5 bg-content-muted rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1.5 h-1.5 bg-content-muted rounded-full animate-bounce" />
                    </div>
                  </div>
                )}

                {bannerMessage && (
                  <div className="bg-warning/10 text-warning text-xs font-bold rounded-xl px-4 py-3 text-center">
                    {bannerMessage}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              <div className="p-3 border-t border-border shrink-0">
                <div className="flex items-center gap-2 bg-surface-muted rounded-2xl border border-border px-3 py-1 focus-within:ring-2 focus-within:ring-brand/20 focus-within:border-brand transition-all">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder={t('ai.type_message_placeholder')}
                    disabled={isSending}
                    className="flex-1 bg-transparent border-none outline-none focus:ring-0 py-2.5 text-sm font-medium text-content placeholder:text-content-muted/60"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={isSending || !input.trim()}
                    className="w-8 h-8 shrink-0 bg-brand text-white rounded-xl flex items-center justify-center disabled:opacity-40 transition-all hover:bg-brand/90"
                  >
                    <Send size={16} className="rtl:-scale-x-100" />
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
