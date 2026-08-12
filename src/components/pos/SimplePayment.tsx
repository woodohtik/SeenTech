/**
 * SimplePayment — شاشة دفع مبسّطة جداً (موجّهة لأصحاب المحلات 40+ قليلي الخبرة التقنية)
 * --------------------------------------------------------------------------------------
 * مبدأ: السهولة قبل الجمال. مبلغ كبير + طريقتا دفع بأزرار ضخمة + زر تأكيد واحد.
 * بلا خصم/ضريبة معقّدة على الواجهة (تطلع تلقائياً في الفاتورة). دفع جزئي اختياري ومطوي.
 *
 * التوصيل: استبدل/كمّل تدفّق الدفع في CartSidebar:
 *   <SimplePayment total={grandTotal} onBack={...} onConfirm={(method, paid) => createOrder(...)} />
 */

import { useState } from 'react';
import { CurrencySymbol } from '../CurrencySymbol';
import { useDirection } from '../../lib/direction';

const INK = '#0E2A42', GRAY = '#6B7280', LINE = '#E5EAF1', CTA = '#0BA06B', CTA_TINT = '#F2FBF7';
type Method = 'cash' | 'network';

interface Props {
  total: number;
  onConfirm: (method: Method, paidAmount: number) => void;
  onBack: () => void;
  allowPartial?: boolean; // افتراضياً مغلق — أبسط
  busy?: boolean;
}

export default function SimplePayment({ total, onConfirm, onBack, allowPartial = false, busy = false }: Props) {
  const { t, dir, pick } = useDirection();
  const [method, setMethod] = useState<Method>('cash');
  const [partial, setPartial] = useState(false);
  const [paid, setPaid] = useState<number>(total);

  const paidAmount = partial ? Math.max(0, Math.min(paid, total)) : total;

  return (
    <div dir={dir} style={s.wrap}>
      <div style={s.bar}>
        <button onClick={onBack} style={s.back} aria-label={t('common.back')}>{pick('→', '←')} {t('common.back')}</button>
        <span style={s.title}>{t('pos.payment_title')}</span>
      </div>

      <div style={s.center}>
        <div style={s.card}>
          <div style={s.lbl}>{t('pos.amount_due')}</div>
          <div style={s.amt}>{total.toLocaleString('en-US')} <span style={s.cur}><CurrencySymbol className="h-[0.9em] w-auto inline-block" /></span></div>

          <div style={s.q}>{t('pos.choose_payment_method')}</div>
          <div style={s.methods}>
            <button onClick={() => setMethod('cash')}
              style={{ ...s.m, ...(method === 'cash' ? s.mOn : {}) }}>
              <span style={s.mt}>{t('common.payment_methods.cash')} {method === 'cash' ? '✓' : ''}</span>
              <span style={s.ms}>{t('pos.full_amount_received')}</span>
            </button>
            <button onClick={() => setMethod('network')}
              style={{ ...s.m, ...(method === 'network' ? s.mOn : {}) }}>
              <span style={s.mt}>{t('pos.network_mada')} {method === 'network' ? '✓' : ''}</span>
              <span style={s.ms}>{t('pos.card_or_apple_pay')}</span>
            </button>
          </div>

          {allowPartial && (
            <div style={s.partialWrap}>
              {!partial ? (
                <button onClick={() => setPartial(true)} style={s.partialToggle}>{t('pos.partial_payment_question')}</button>
              ) : (
                <div style={s.partialRow}>
                  <span style={s.partialLbl}>{t('pos.paid_amount')}</span>
                  <input type="number" inputMode="numeric" value={paid}
                    onChange={(e) => setPaid(Number(e.target.value) || 0)} style={s.partialInput} />
                  <span style={s.partialRem}>{t('pos.remaining_balance')} {(total - paidAmount).toLocaleString('en-US')} <CurrencySymbol className="h-[1em] w-auto inline-block" /></span>
                </div>
              )}
            </div>
          )}

          <button onClick={() => onConfirm(method, paidAmount)} disabled={busy}
            style={{ ...s.confirm, ...(busy ? { opacity: 0.7 } : {}) }}>
            {busy ? t('common.saving') : t('pos.confirm_pay_and_print')}
          </button>
          <div style={s.hint}>{t('pos.zatca_invoice_auto_note')}</div>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { minHeight: '100%', background: '#EEF1F5', color: INK },
  bar: { height: 62, background: '#fff', borderBottom: '1px solid ' + LINE, display: 'flex', alignItems: 'center', gap: 16, padding: '0 24px' },
  back: { background: 'none', border: 'none', fontSize: 20, fontWeight: 800, color: INK, cursor: 'pointer' },
  title: { fontSize: 20, fontWeight: 800 },
  center: { display: 'flex', justifyContent: 'center', padding: '38px 16px' },
  card: { width: '100%', maxWidth: 600, background: '#fff', borderRadius: 24, padding: '34px 38px', boxShadow: '0 16px 40px rgba(14,42,66,.1)', textAlign: 'center' },
  lbl: { fontSize: 21, color: GRAY, fontWeight: 700 },
  amt: { fontSize: 64, fontWeight: 800, color: INK, lineHeight: 1.15, margin: '2px 0' },
  cur: { fontSize: 25, color: GRAY },
  q: { fontSize: 18, color: GRAY, fontWeight: 700, margin: '20px 0 12px' },
  methods: { display: 'flex', gap: 16 },
  m: { flex: 1, height: 118, border: '3px solid ' + LINE, borderRadius: 18, background: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 },
  mOn: { borderColor: CTA, background: CTA_TINT },
  mt: { fontSize: 23, fontWeight: 800, color: INK },
  ms: { fontSize: 14, color: GRAY, fontWeight: 600 },
  partialWrap: { marginTop: 16 },
  partialToggle: { background: 'none', border: 'none', color: INK, fontWeight: 700, fontSize: 15, cursor: 'pointer', textDecoration: 'underline' },
  partialRow: { display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', flexWrap: 'wrap' },
  partialLbl: { fontSize: 16, fontWeight: 700, color: INK },
  partialInput: { width: 140, fontSize: 22, fontWeight: 800, textAlign: 'center', padding: '8px 10px', border: '2px solid ' + LINE, borderRadius: 12 },
  partialRem: { fontSize: 14, color: GRAY, fontWeight: 600 },
  confirm: { display: 'block', width: '100%', background: CTA, color: '#fff', fontSize: 26, fontWeight: 800, textAlign: 'center', padding: '21px 0', borderRadius: 18, border: 'none', cursor: 'pointer', marginTop: 22, boxShadow: '0 14px 30px rgba(11,160,107,.32)' },
  hint: { color: '#9AA4B0', fontSize: 15, marginTop: 13 },
};
