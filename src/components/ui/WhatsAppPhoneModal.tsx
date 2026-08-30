import React, { useState } from 'react';
import { MessageCircle, ArrowLeft } from 'lucide-react';
import { formatSaudiPhone } from '../../utils/phoneUtils';
import { useTranslation } from 'react-i18next';
import { useDirection } from '../../lib/direction';

interface WhatsAppPhoneModalProps {
  onClose: () => void;
  /** Called with the phone already formatted for wa.me (digits only, country code, no '+'). */
  onConfirm: (phoneForWhatsApp: string) => void;
  /** Known phone for the recipient (customer/supplier), pre-filled but editable. */
  defaultPhone?: string;
  title: string;
  description: React.ReactNode;
}

/**
 * Recipient phone step shown before opening WhatsApp to send an invoice or
 * account statement. wa.me/api.whatsapp.com links can't attach a file, so
 * the caller is expected to have already saved the PDF and to instruct the
 * user to attach it manually -- this modal only resolves which number to
 * open the chat with.
 */
export default function WhatsAppPhoneModal({ onClose, onConfirm, defaultPhone, title, description }: WhatsAppPhoneModalProps) {
  const { t } = useTranslation();
  const { dir } = useDirection();
  const [phone, setPhone] = useState(defaultPhone || '');

  const handleConfirm = () => {
    const formatted = formatSaudiPhone(phone).replace('+', '');
    if (!formatted) return;
    onConfirm(formatted);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[200] print:hidden animate-fade-in" dir={dir}>
      <div className="bg-surface border border-border rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-emerald-500/10 text-emerald-600 rounded-full flex items-center justify-center">
            <MessageCircle size={24} />
          </div>
          <h3 className="text-lg font-black text-content">{title}</h3>
          <div className="text-xs font-bold text-content-muted leading-relaxed">{description}</div>
        </div>

        <div className="space-y-2 text-start">
          <label className="block text-xs font-black text-content-muted">
            {t('z_report.recipient_phone', 'رقم جوال المستلم (مثال: 0501234567)')}
          </label>
          <input
            type="text"
            placeholder={t('z_report.recipient_phone_placeholder', 'أدخل رقم الجوال هنا')}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={(e) => setPhone(formatSaudiPhone(e.target.value))}
            className="w-full px-4 py-3 border border-border rounded-2xl text-sm font-bold text-content focus:outline-none focus:border-emerald-500 bg-surface-muted focus:bg-surface transition-all"
            dir="ltr"
          />
        </div>

        <div className="flex gap-2 font-black">
          <button
            onClick={handleConfirm}
            disabled={!phone.trim()}
            className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/30 disabled:cursor-not-allowed text-white rounded-xl text-xs font-black shadow-md shadow-emerald-600/15 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <span>{t('z_report.continue_to_whatsapp', 'متابعة إلى واتساب')}</span>
            <ArrowLeft size={14} className="rotate-180" />
          </button>
          <button
            onClick={onClose}
            className="px-4 py-3 bg-surface-muted hover:bg-border text-content transition-colors cursor-pointer rounded-xl text-xs font-black"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
