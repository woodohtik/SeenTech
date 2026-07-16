/**
 * SaaSWithdrawals — مراجعة طلبات سحب الإحالة (داشبورد إدارة سين)
 * -------------------------------------------------------------
 * يعرض الطلبات «قيد المراجعة» مع الآيبان والمبلغ. الأدمن يوافق (بعد التحويل) أو يرفض (يُرجع الرصيد).
 * التوصيل: ضمن لوحة الأدمن (SuperAdminDashboard / SaaSLayout) — مسار مثل /admin/withdrawals.
 */

import { useEffect, useState } from 'react';
import { listPendingWithdrawals, processWithdrawal, type Withdrawal } from '../services/referralService';
import { useTranslation } from 'react-i18next';

const INK = '#0E2A42', CTA = '#0BA06B', GRAY = '#6B7280', LINE = '#E5EAF1', SURF = '#F5F7FA';

export default function SaaSWithdrawals() {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar' || i18n.language === 'ur';

  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  async function load() {
    setLoading(true);
    try { setRows(await listPendingWithdrawals()); } finally { setLoading(false); }
  }
  const [toast, setToast] = useState<{message: string, type: 'success'|'error'} | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };
  
  useEffect(() => { load(); }, []);

  async function act(id: string, approve: boolean) {
    const note = approve 
      ? t('saas.success', 'تم التحويل بنجاح') 
      : (window.prompt(t('saas.rejection_reason_prompt', 'سبب الرفض؟')) || t('saas.rejection_reason_default', 'مرفوض'));
    setBusyId(id);
    try { 
      await processWithdrawal(id, approve, note); 
      await load(); 
    } catch (e: any) { 
      alert(e?.message || t('saas.failed', 'فشل')); 
    } finally { 
      setBusyId(''); 
    }
  }

  return (
    <div dir={isRtl ? "rtl" : "ltr"} style={st.wrap}>
      <h1 style={st.title}>{t('saas.withdrawals_title', 'طلبات سحب الإحالة')}</h1>
      <p style={st.sub}>{t('saas.withdrawals_subtitle', 'راجع، حوّل المبلغ بنكياً للآيبان، ثم اضغط «تم التحويل». الرفض يُرجع المبلغ لمحفظة العميل.')}</p>

      {loading ? <div style={st.empty}>{t('saas.loading', 'جارٍ التحميل…')}</div> :
        rows.length === 0 ? <div style={st.empty}>{t('saas.no_withdrawals', 'لا طلبات قيد المراجعة.')}</div> :
        <div className="seen-table-scroll"><table style={st.table}>
          <thead><tr>
            {[
              t('saas.date', 'التاريخ'),
              t('saas.amount', 'المبلغ'),
              t('saas.beneficiary', 'المستفيد'),
              t('saas.iban', 'الآيبان (IBAN)'),
              t('saas.action', 'إجراء')
            ].map(h =>
              <th key={h} style={{ ...st.th, textAlign: isRtl ? 'right' : 'left' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(w => (
              <tr key={w.id}>
                <td style={{ ...st.td, textAlign: isRtl ? 'right' : 'left' }}>{new Date(w.requested_at).toLocaleDateString('en-GB')}</td>
                <td style={{ ...st.td, fontWeight: 800, color: INK, textAlign: isRtl ? 'right' : 'left' }}>{w.amount.toLocaleString('en-US')} {t('common.currency_saudi_riyal', 'ر.س')}</td>
                <td style={{ ...st.td, textAlign: isRtl ? 'right' : 'left' }}>{w.beneficiary || '—'}</td>
                <td style={{ ...st.td, direction: 'ltr', fontSize: 13, textAlign: isRtl ? 'right' : 'left' }}>{w.iban || '—'}</td>
                <td style={{ ...st.td, textAlign: isRtl ? 'right' : 'left' }}>
                  <button disabled={busyId === w.id} onClick={() => act(w.id, true)} style={{ ...st.approve, marginLeft: isRtl ? 8 : 0, marginRight: isRtl ? 0 : 8 }}>{t('saas.transferred', 'تم التحويل')}</button>
                  <button disabled={busyId === w.id} onClick={() => act(w.id, false)} style={st.reject}>{t('saas.reject', 'رفض')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: {  padding: 24, color: '#34404D' },
  title: { fontFamily: "'Tajawal', sans-serif", fontWeight: 800, fontSize: 26, color: INK, margin: 0 },
  sub: { color: GRAY, fontSize: 14.5, margin: '6px 0 20px' },
  empty: { color: GRAY, fontSize: 15, padding: '30px 0', textAlign: 'center', background: SURF, borderRadius: 14 },
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 14, overflow: 'hidden', border: `1px solid ${LINE}` },
  th: { background: INK, color: '#fff', fontFamily: "'Tajawal', sans-serif", fontWeight: 700, fontSize: 14, padding: '12px 14px' },
  td: { padding: '12px 14px', borderBottom: `1px solid ${LINE}`, fontSize: 14.5 },
  approve: { background: CTA, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 16px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' },
  reject: { background: 'transparent', color: '#C0392B', border: '1px solid #C0392B', borderRadius: 9, padding: '8px 14px', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' },
};
