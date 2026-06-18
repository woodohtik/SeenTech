/**
 * SaaSWithdrawals — مراجعة طلبات سحب الإحالة (داشبورد إدارة سين)
 * -------------------------------------------------------------
 * يعرض الطلبات «قيد المراجعة» مع الآيبان والمبلغ. الأدمن يوافق (بعد التحويل) أو يرفض (يُرجع الرصيد).
 * التوصيل: ضمن لوحة الأدمن (SuperAdminDashboard / SaaSLayout) — مسار مثل /admin/withdrawals.
 */

import { useEffect, useState } from 'react';
import { listPendingWithdrawals, processWithdrawal, type Withdrawal } from '../services/referralService';

const INK = '#0E2A42', CTA = '#0BA06B', GRAY = '#6B7280', LINE = '#E5EAF1', SURF = '#F5F7FA';
const FONT = "'IBM Plex Sans Arabic', system-ui, sans-serif";

export default function SaaSWithdrawals() {
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  async function load() {
    setLoading(true);
    try { setRows(await listPendingWithdrawals()); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function act(id: string, approve: boolean) {
    const note = approve ? 'تم التحويل بنجاح' : (window.prompt('سبب الرفض؟') || 'مرفوض');
    setBusyId(id);
    try { await processWithdrawal(id, approve, note); await load(); }
    catch (e: any) { alert(e?.message || 'فشل'); } finally { setBusyId(''); }
  }

  return (
    <div dir="rtl" style={st.wrap}>
      <h1 style={st.title}>طلبات سحب الإحالة</h1>
      <p style={st.sub}>راجع، حوّل المبلغ بنكياً للآيبان، ثم اضغط «تم التحويل». الرفض يُرجع المبلغ لمحفظة العميل.</p>

      {loading ? <div style={st.empty}>جارٍ التحميل…</div> :
        rows.length === 0 ? <div style={st.empty}>لا طلبات قيد المراجعة.</div> :
        <table style={st.table}>
          <thead><tr>
            {['التاريخ', 'المبلغ', 'المستفيد', 'الآيبان (IBAN)', 'إجراء'].map(h =>
              <th key={h} style={st.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map(w => (
              <tr key={w.id}>
                <td style={st.td}>{new Date(w.requested_at).toLocaleDateString('en-GB')}</td>
                <td style={{ ...st.td, fontWeight: 800, color: INK }}>{w.amount.toLocaleString('en-US')} ر.س</td>
                <td style={st.td}>{w.beneficiary || '—'}</td>
                <td style={{ ...st.td, direction: 'ltr', fontSize: 13 }}>{w.iban || '—'}</td>
                <td style={st.td}>
                  <button disabled={busyId === w.id} onClick={() => act(w.id, true)} style={st.approve}>تم التحويل</button>
                  <button disabled={busyId === w.id} onClick={() => act(w.id, false)} style={st.reject}>رفض</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { fontFamily: FONT, padding: 24, color: '#34404D' },
  title: { fontFamily: "'Tajawal', sans-serif", fontWeight: 800, fontSize: 26, color: INK, margin: 0 },
  sub: { color: GRAY, fontSize: 14.5, margin: '6px 0 20px' },
  empty: { color: GRAY, fontSize: 15, padding: '30px 0', textAlign: 'center', background: SURF, borderRadius: 14 },
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 14, overflow: 'hidden', border: `1px solid ${LINE}` },
  th: { background: INK, color: '#fff', fontFamily: "'Tajawal', sans-serif", fontWeight: 700, fontSize: 14, padding: '12px 14px', textAlign: 'right' },
  td: { padding: '12px 14px', borderBottom: `1px solid ${LINE}`, fontSize: 14.5, textAlign: 'right' },
  approve: { background: CTA, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 16px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', marginLeft: 8, fontFamily: FONT },
  reject: { background: 'transparent', color: '#C0392B', border: '1px solid #C0392B', borderRadius: 9, padding: '8px 14px', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: FONT },
};
