import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, Sparkles, X, Send, AlertTriangle, TrendingUp, FileText, Users, PackageSearch } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useDirection } from '../lib/direction';
import { supabase } from '../lib/supabase/client';
import { cn } from '../lib/utils';
import { PriceDisplay } from './PriceDisplay';

interface ToolResult {
  name: string;
  result: any;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolResults?: ToolResult[];
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

      setMessages(prev => [...prev, { role: 'assistant', content: '', toolResults: [] }]);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let textAcc = '';
      const toolResultsAcc: ToolResult[] = [];
      let lineBuffer = '';
      // eslint-disable-next-line no-constant-condition
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
            if (part.t === 'text') textAcc += part.v;
            else if (part.t === 'tool') toolResultsAcc.push({ name: part.name, result: part.result });
          } catch {
            // سطر NDJSON غير صالح (نادر) — تجاهله بدل كسر المحادثة كاملة
          }
        }
        const textSnapshot = textAcc;
        const toolsSnapshot = [...toolResultsAcc];
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: textSnapshot, toolResults: toolsSnapshot };
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
          <div className="fixed inset-0 z-50" dir={dir}>
            {/* موبايل: خلفية معتمة + ورقة سفلية بعرض الشاشة. سطح المكتب: طبقة شفافة
                لإغلاق النافذة بالنقر خارجها فقط، بلا تعتيم — النافذة ترتكز بجانب
                الزر العائم نفسه (أسفل اليسار عربي/أردو، أسفل اليمين إنجليزي). */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-none"
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "absolute inset-x-0 bottom-0 bg-surface w-full h-[85vh] rounded-t-3xl shadow-2xl overflow-hidden border border-border flex flex-col",
                "sm:inset-x-auto sm:bottom-24 sm:h-[600px] sm:w-full sm:max-w-sm sm:rounded-3xl",
                isRtl ? "sm:left-6" : "sm:right-6"
              )}
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
                  <div key={i} className={`flex flex-col gap-2 ${m.role === 'user' ? 'items-end' : 'items-start'} ${m.role === 'user' ? 'rtl:items-start' : 'rtl:items-end'}`}>
                    {m.toolResults?.map((tr, ti) => (
                      <ToolResultCard key={ti} name={tr.name} result={tr.result} />
                    ))}
                    {m.content && (
                      <div
                        className={
                          m.role === 'user'
                            ? 'max-w-[80%] bg-brand text-white rounded-2xl rounded-tr-md px-4 py-2.5 text-sm font-medium whitespace-pre-wrap'
                            : 'max-w-[80%] bg-surface-muted text-content rounded-2xl rounded-tl-md px-4 py-2.5 text-sm font-medium whitespace-pre-wrap'
                        }
                      >
                        {m.content}
                      </div>
                    )}
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

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="max-w-[90%] w-full bg-surface-muted border border-border rounded-2xl px-4 py-3 text-xs font-bold text-content-muted text-center">
      {text}
    </div>
  );
}

// عرض توليدي (Generative UI) بسيط: كل أداة بيانات تُعرض كبطاقة/جدول مصغّر
// حسب نوعها بدل نص خام فقط، مبني على toolName + result القادمين من بروتوكول
// NDJSON في server.ts (streamAssistantReply).
function ToolResultCard({ name, result }: { name: string; result: any }) {
  const { t } = useTranslation();
  if (!result) return null;

  if (result.denied) {
    return (
      <div className="max-w-[90%] w-full bg-warning/10 border border-warning/20 rounded-2xl px-4 py-3 text-xs font-bold text-warning flex items-center gap-2">
        <AlertTriangle size={16} className="shrink-0" />
        {result.message || t('ai.card_access_denied')}
      </div>
    );
  }

  switch (name) {
    case 'getSalesSummary':
    case 'getRevenueReport':
    case 'getDailyClosingReport': {
      const stats: { label: string; value: number }[] = [
        { label: t('ai.card_total_sales'), value: Number(result.totalSales) || 0 },
        { label: t('ai.card_collected'), value: Number(result.totalRevenueCollected) || 0 },
      ];
      if (result.totalTax !== undefined) stats.push({ label: t('ai.card_tax'), value: Number(result.totalTax) || 0 });
      if (result.totalDiscount !== undefined) stats.push({ label: t('ai.card_discount'), value: Number(result.totalDiscount) || 0 });
      return (
        <div className="max-w-[90%] w-full bg-surface border border-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-black text-brand uppercase tracking-widest">
            <TrendingUp size={14} /> {t('ai.card_summary')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {stats.map((s, i) => (
              <div key={i}>
                <div className="text-[10px] text-content-muted font-bold">{s.label}</div>
                <div className="text-sm font-black text-content"><PriceDisplay amount={s.value} /></div>
              </div>
            ))}
          </div>
          {typeof result.invoiceCount === 'number' && (
            <div className="text-[10px] text-content-muted font-bold pt-2 border-t border-border">
              {t('ai.card_invoice_count')}: {result.invoiceCount}
            </div>
          )}
        </div>
      );
    }
    case 'searchInvoices': {
      const invoices = result.invoices || [];
      if (invoices.length === 0) return <EmptyCard text={t('ai.card_no_results')} />;
      return (
        <div className="max-w-[90%] w-full bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 text-xs font-black text-brand uppercase tracking-widest p-3 border-b border-border">
            <FileText size={14} /> {t('ai.card_invoices')} ({invoices.length})
          </div>
          <div className="divide-y divide-border max-h-52 overflow-y-auto">
            {invoices.map((inv: any, i: number) => (
              <div key={i} className="p-3 flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="font-bold text-content truncate">#{inv.order_number} — {inv.customer_name}</div>
                  <div className="text-content-muted">{String(inv.order_date || '').slice(0, 10)}</div>
                </div>
                <div className="font-black text-content shrink-0"><PriceDisplay amount={Number(inv.total_amount) || 0} /></div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case 'getTopSellingItems': {
      const items = result.items || [];
      if (items.length === 0) return <EmptyCard text={t('ai.card_no_sales_data')} />;
      return (
        <div className="max-w-[90%] w-full bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 text-xs font-black text-brand uppercase tracking-widest p-3 border-b border-border">
            <TrendingUp size={14} /> {t('ai.card_top_selling')}
          </div>
          <div className="divide-y divide-border">
            {items.map((it: any, i: number) => (
              <div key={i} className="p-3 flex items-center justify-between text-xs">
                <span className="font-bold text-content">{it.name}</span>
                <span className="text-content-muted font-black">{it.total_quantity}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case 'getLowStockAlerts': {
      const items = result.items || [];
      if (items.length === 0) return <EmptyCard text={t('ai.card_no_low_stock')} />;
      return (
        <div className="max-w-[90%] w-full bg-danger/5 border border-danger/20 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 text-xs font-black text-danger uppercase tracking-widest p-3 border-b border-danger/20">
            <AlertTriangle size={14} /> {t('ai.card_low_stock')}
          </div>
          <div className="divide-y divide-danger/10">
            {items.map((it: any, i: number) => (
              <div key={i} className="p-3 flex items-center justify-between text-xs">
                <span className="font-bold text-content">{it.name}</span>
                <span className="text-danger font-black">{it.current_quantity} / {it.min_threshold}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case 'getInventoryStatus': {
      const items = result.items || [];
      if (!result.found || items.length === 0) return <EmptyCard text={t('ai.card_item_not_found')} />;
      return (
        <div className="max-w-[90%] w-full bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 text-xs font-black text-brand uppercase tracking-widest p-3 border-b border-border">
            <PackageSearch size={14} /> {t('ai.card_inventory_status')}
          </div>
          <div className="divide-y divide-border">
            {items.map((it: any, i: number) => (
              <div key={i} className="p-3 text-xs space-y-1">
                <div className="font-bold text-content">{it.name}</div>
                <div className="flex items-center justify-between text-content-muted">
                  <span>{it.currentQuantity} {it.unit}</span>
                  <PriceDisplay amount={Number(it.pricePerUnit) || 0} />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case 'getCustomerHistory': {
      const customers = result.customers || [];
      if (!result.found || customers.length === 0) return <EmptyCard text={t('ai.card_customer_not_found')} />;
      return (
        <div className="max-w-[90%] w-full bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 text-xs font-black text-brand uppercase tracking-widest p-3 border-b border-border">
            <Users size={14} /> {t('ai.card_customer_history')}
          </div>
          {customers.map((c: any, ci: number) => (
            <div key={ci} className="divide-y divide-border">
              <div className="p-3 text-xs font-black text-content bg-surface-muted/50">{c.name} — {c.phone}</div>
              {(c.orders || []).map((o: any, oi: number) => (
                <div key={oi} className="p-3 flex items-center justify-between text-xs">
                  <span className="text-content-muted">#{o.order_number}</span>
                  <PriceDisplay amount={Number(o.total_amount) || 0} />
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    }
    case 'getPendingOrders': {
      const orders = result.orders || [];
      if (orders.length === 0) return <EmptyCard text={t('ai.card_no_pending_orders')} />;
      return (
        <div className="max-w-[90%] w-full bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 text-xs font-black text-brand uppercase tracking-widest p-3 border-b border-border">
            <FileText size={14} /> {t('ai.card_pending_orders')} ({orders.length})
          </div>
          <div className="divide-y divide-border max-h-52 overflow-y-auto">
            {orders.map((o: any, i: number) => (
              <div key={i} className="p-3 flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-content truncate">#{o.order_number} — {o.customer_name}</span>
                <span className="text-content-muted shrink-0">{o.status}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}
