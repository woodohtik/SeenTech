import React from 'react';
import { MessageCircle, X } from 'lucide-react';
import { useDirection } from '../../lib/direction';
import { openWhatsApp, whatsappMessage } from '../../utils/whatsapp';

/**
 * When an order reaches "ready for pickup": offer to tell the customer
 * (seen-merchant-trial-test-2026-11-26.md, phase 2 item 6), with the shop's
 * own "order ready" template (seen-whatsapp-templates-task.md). Only a
 * suggestion -- WhatsApp opens with the message, the staff member sends it.
 */
export interface ReadyOrder {
  customerName?: string | null;
  orderNumber?: string | number | null;
  totalAmount?: number | null;
  trackingToken?: string | null;
  phone: string;
}

export function readyMessage(order: ReadyOrder): string {
  return whatsappMessage('order_ready', {
    customerName: order.customerName,
    orderNumber: order.orderNumber,
    total: order.totalAmount,
    trackingToken: order.trackingToken,
    customerPhone: order.phone,
  });
}

export function OrderReadyPrompt({ order, onClose }: { order: ReadyOrder; onClose: () => void }) {
  const { t, dir } = useDirection();
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="order-ready-title" dir={dir}
      className="fixed bottom-4 inset-x-4 main-640:inset-x-auto main-640:end-6 main-640:w-96 z-[165] rounded-3xl bg-surface border border-border shadow-2xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="order-ready-title" className="text-base font-black text-content">{t('orders.ready_prompt_title')}</h3>
          <p className="text-sm font-bold text-content-muted">{t('orders.ready_prompt_body', { name: order.customerName || '' })}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('common.close')} className="min-w-11 min-h-11 inline-flex items-center justify-center rounded-full text-content-muted hover:bg-surface-muted">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {order.phone ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { openWhatsApp({ phone: order.phone, message: readyMessage(order), kind: 'customer' }); onClose(); }}
            className="flex-1 min-h-11 inline-flex items-center justify-center gap-2 rounded-2xl bg-success text-white font-bold text-sm"
          >
            <MessageCircle size={18} aria-hidden="true" />
            {t('orders.ready_prompt_send')}
          </button>
          <button type="button" onClick={onClose} className="min-h-11 px-4 rounded-2xl border border-border text-content font-bold text-sm hover:bg-surface-muted">
            {t('orders.ready_prompt_later')}
          </button>
        </div>
      ) : (
        <p className="text-sm font-bold text-content-muted">{t('orders.ready_prompt_no_phone')}</p>
      )}
    </div>
  );
}
