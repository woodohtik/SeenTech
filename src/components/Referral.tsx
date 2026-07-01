/**
 * Referral — لوحة برنامج الإحالة للعميل (داخل الداشبورد)
 * -----------------------------------------------------
 * رابط خاص + محفظة (300 ر.س عند اشتراك المُحال خلال شهر) + طلب سحب عند تجاوز 1000.
 * التوصيل: <Route path="/referral" element={<Referral tenantId={effectiveTenantId} />} />
 */

import { useEffect, useState } from 'react';
import {
  ensureReferralCode, referralLink, getWallet, listReferrals, listMyWithdrawals,
  requestWithdrawal, MIN_WITHDRAWAL, REWARD_PER_REFERRAL,
  type Wallet, type ReferralRow, type Withdrawal,
} from '../services/referralService';

const INK = '#0E2A42', BRAND = '#34BBED', CTA = '#0BA06B', CTA2 = '#0A8A5C';
const SURF = '#F5F7FA', GRAY = '#6B7280', TEXT = '#34404D', LINE = '#E5EAF1', MINT = '#E7F7EE', TINT = '#EAF6FD';
const FONT = "'IBM Plex Sans Arabic', system-ui, sans-serif";

export default function Referral({ tenantId }: { tenantId: string }) {
  const [link, setLink] = useState('');
  const [wallet, setWallet] = useState<Wallet>({ balance: 0, total_earned: 0 });
  const [refs, setRefs] = useState<ReferralRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [copied, setCopied] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const code = await ensureReferralCode(tenantId);
      setLink(referralLink(code));
      const [w, r, wd] = await Promise.all([
        getWallet(tenantId), listReferrals(tenantId), listMyWithdrawals(tenantId),
      ]);
      setWallet(w); setRefs(r); setWithdrawals(wd);
    } catch (e) { console.warn('[referral] load failed', e); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (tenantId) load(); /* eslint-disable-next-line */ }, [tenantId]);

  function copy() {
    navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
  }
  function shareWhatsApp() {
    const msg = `جرّب «سين» — نظام إدارة محلات الخياطة. سجّل من رابطي: ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }

  const pct = Math.min(100, Math.round((wallet.balance / MIN_WITHDRAWAL) * 100));
  const canWithdraw = wallet.balance > MIN_WITHDRAWAL;

  return (
    <div dir="rtl" style={s.wrap}>
      <div style={s.head}>
        <h2 style={s.title}>برنامج الإحالة</h2>
        <p style={s.sub}>ادعُ محلات خياطة أخرى لسين — لك {REWARD_PER_REFERRAL} ر.س عن كل محل يشترك عبر رابطك.</p>
      </div>

      <div style={s.grid}>
        {/* wallet */}
        <div style={{ ...s.card, ...s.walletCard }}>
          <div style={s.cardLbl}>رصيد محفظتك</div>
          <div style={s.balance}>{wallet.balance.toLocaleString('en-US')} <span style={s.cur}>ر.س</span></div>
          <div style={s.barTrack}><div style={{ ...s.barFill, width: `${pct}%` }} /></div>
          <div style={s.barNote}>
            {canWithdraw ? 'جاهز للسحب ✓' : `باقي ${(MIN_WITHDRAWAL - wallet.balance).toLocaleString('en-US')} ر.س للسحب (فوق ${MIN_WITHDRAWAL})`}
          </div>
          <button disabled={!canWithdraw} onClick={() => setShowModal(true)}
            style={{ ...s.cta, ...(canWithdraw ? {} : s.ctaDisabled) }}>اطلب تحويل المبلغ</button>
          <div style={s.earned}>إجمالي ما كسبته: {wallet.total_earned.toLocaleString('en-US')} ر.س · {refs.length} إحالة</div>
        </div>

        {/* link */}
        <div style={s.card}>
          <div style={s.cardLbl}>رابط الإحالة الخاص بك</div>
          <div style={s.linkRow}>
            <input readOnly value={link} style={s.linkInput} dir="ltr" />
            <button onClick={copy} style={s.copyBtn}>{copied ? 'تم النسخ ✓' : 'نسخ'}</button>
          </div>
          <button onClick={shareWhatsApp} style={s.waBtn}>شارك عبر واتساب</button>
          <div style={s.hint}>عند اشتراك أي محل سجّل من رابطك (خلال شهر من تسجيله) تُضاف لك {REWARD_PER_REFERRAL} ر.س تلقائياً في محفظتك.</div>
        </div>
      </div>

      {/* referrals */}
      <div style={{ ...s.card, marginTop: 18 }}>
        <div style={s.cardLbl}>إحالاتك ({refs.length})</div>
        {loading ? <div style={s.empty}>جارٍ التحميل…</div> :
          refs.length === 0 ? <div style={s.empty}>لا إحالات بعد — شارك رابطك وابدأ الكسب.</div> :
          <div>{refs.map(r => { const rs = refStatus(r); return (
            <div key={r.id} style={s.rowItem}>
              <span style={{ ...s.badge, background: rs.bg, color: rs.fg }}>{rs.label}</span>
              <span style={s.rowDate}>{new Date(r.created_at).toLocaleDateString('en-GB')}</span>
              <span style={s.rowText}>{rs.text}</span>
            </div>
          ); })}</div>}
      </div>

      {/* withdrawals */}
      {withdrawals.length > 0 && (
        <div style={{ ...s.card, marginTop: 18 }}>
          <div style={s.cardLbl}>طلبات السحب</div>
          {withdrawals.map(w => (
            <div key={w.id} style={s.rowItem}>
              <span style={{ ...s.badge, background: wStatusColor(w.status).bg, color: wStatusColor(w.status).fg }}>{wStatusLabel(w.status)}</span>
              <span style={s.rowDate}>{new Date(w.requested_at).toLocaleDateString('en-GB')}</span>
              <span style={s.rowText}>{w.amount.toLocaleString('en-US')} ر.س</span>
            </div>
          ))}
        </div>
      )}

      {showModal && <WithdrawModal balance={wallet.balance} onClose={() => setShowModal(false)}
        onDone={() => { setShowModal(false); load(); }} tenantId={tenantId} />}
    </div>
  );
}

function WithdrawModal({ tenantId, balance, onClose, onDone }:
  { tenantId: string; balance: number; onClose: () => void; onDone: () => void }) {
  const [iban, setIban] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState<number>(balance);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    if (!/^SA\d{22}$/.test(iban.replace(/\s/g, ''))) { setErr('أدخل رقم آيبان سعودي صحيح (SA + 22 رقم).'); return; }
    if (!name.trim()) { setErr('أدخل اسم المستفيد.'); return; }
    if (amount <= MIN_WITHDRAWAL || amount > balance) { setErr(`المبلغ أكثر من ${MIN_WITHDRAWAL} وحتى ${balance} ر.س.`); return; }
    setBusy(true);
    try { await requestWithdrawal(tenantId, amount, iban.replace(/\s/g, ''), name.trim()); onDone(); }
    catch (e: any) { setErr(e?.message || 'تعذّر إرسال الطلب.'); setBusy(false); }
  }

  return (
    <div dir="rtl" style={s.overlay}>
      <div style={s.modal}>
        <h3 style={s.modalTitle}>طلب تحويل المبلغ</h3>
        <p style={s.modalSub}>يصل طلبك لفريق سين، ونحوّل المبلغ خلال 3–5 أيام عمل بعد التأكّد.</p>
        <label style={s.field}><span style={s.flbl}>اسم المستفيد</span>
          <input value={name} onChange={e => setName(e.target.value)} style={s.input} /></label>
        <label style={s.field}><span style={s.flbl}>رقم الآيبان (IBAN)</span>
          <input value={iban} onChange={e => setIban(e.target.value)} placeholder="SAxxxxxxxxxxxxxxxxxxxxxx" dir="ltr" style={s.input} /></label>
        <label style={s.field}><span style={s.flbl}>المبلغ (ر.س)</span>
          <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value) || 0)} style={s.input} /></label>
        {err && <div style={s.err}>{err}</div>}
        <button onClick={submit} disabled={busy} style={{ ...s.cta, marginTop: 8, ...(busy ? s.ctaDisabled : {}) }}>
          {busy ? 'جارٍ الإرسال…' : 'إرسال الطلب'}</button>
        <button onClick={onClose} style={s.cancel}>إلغاء</button>
      </div>
    </div>
  );
}

function refStatus(r: ReferralRow): { label: string; text: string; bg: string; fg: string } {
  const expiredByTime = r.status === 'pending' && r.qualified_until && new Date(r.qualified_until).getTime() < Date.now();
  if (r.status === 'credited') return { label: `+${r.reward_amount} ر.س`, text: 'اشترك — أُضيفت المكافأة', bg: MINT, fg: CTA2 };
  if (r.status === 'expired' || expiredByTime) return { label: 'انتهت المهلة', text: 'لم يشترك خلال شهر', bg: '#EEF1F4', fg: GRAY };
  if (r.status === 'rejected') return { label: 'مرفوضة', text: 'إحالة غير مؤهّلة', bg: '#F7D9D5', fg: '#C0392B' };
  return { label: 'بانتظار الاشتراك', text: 'سجّل — المكافأة عند اشتراكه', bg: '#FBEAD0', fg: '#B9770E' };
}
function wStatusLabel(s: string) { return s === 'paid' ? 'تم التحويل ✓' : s === 'pending' ? 'قيد المراجعة' : s === 'approved' ? 'موافَق عليه' : 'مرفوض'; }
function wStatusColor(s: string) { return s === 'paid' ? { bg: MINT, fg: CTA2 } : s === 'rejected' ? { bg: '#F7D9D5', fg: '#C0392B' } : { bg: TINT, fg: '#2E75B6' }; }

const s: Record<string, React.CSSProperties> = {
  wrap: { fontFamily: FONT, color: TEXT, padding: 24, maxWidth: 1000, margin: '0 auto' },
  head: { marginBottom: 20 },
  title: { fontFamily: "'Tajawal', sans-serif", fontWeight: 800, fontSize: 28, color: INK, margin: 0 },
  sub: { color: GRAY, fontSize: 15.5, margin: '6px 0 0' },
  grid: { display: 'flex', gap: 18, flexWrap: 'wrap' },
  card: { flex: '1 1 340px', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: 24, boxShadow: '0 8px 24px rgba(14,42,66,.06)' },
  walletCard: { background: `linear-gradient(135deg, ${INK}, #15395A)`, border: 'none', color: '#fff' },
  cardLbl: { fontFamily: "'Tajawal', sans-serif", fontWeight: 700, fontSize: 16, color: 'inherit', marginBottom: 12, opacity: 0.92 },
  balance: { fontFamily: "'Tajawal', sans-serif", fontWeight: 800, fontSize: 46, lineHeight: 1, color: '#fff' },
  cur: { fontSize: 20, color: '#9FB6D4' },
  barTrack: { height: 8, background: 'rgba(255,255,255,.18)', borderRadius: 8, marginTop: 16, overflow: 'hidden' },
  barFill: { height: '100%', background: BRAND, borderRadius: 8 },
  barNote: { fontSize: 13, color: '#cfe0f2', marginTop: 8 },
  cta: { display: 'block', width: '100%', background: CTA, color: '#fff', border: 'none', borderRadius: 12, padding: '13px 0', fontWeight: 800, fontSize: 15.5, cursor: 'pointer', marginTop: 16, fontFamily: "'Tajawal', sans-serif" },
  ctaDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  earned: { fontSize: 13, color: '#9FB6D4', marginTop: 12, textAlign: 'center' },
  linkRow: { display: 'flex', gap: 8 },
  linkInput: { flex: 1, border: `1px solid ${LINE}`, borderRadius: 10, padding: '11px 12px', fontSize: 13, background: SURF, color: INK, fontFamily: FONT },
  copyBtn: { background: INK, color: '#fff', border: 'none', borderRadius: 10, padding: '0 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: FONT },
  waBtn: { width: '100%', background: '#25D366', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginTop: 12, fontFamily: FONT },
  hint: { fontSize: 13, color: GRAY, marginTop: 12, lineHeight: 1.7 },
  empty: { color: GRAY, fontSize: 14, padding: '14px 0' },
  rowItem: { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: `1px solid ${LINE}` },
  badge: { fontWeight: 800, fontSize: 13, borderRadius: 8, padding: '4px 12px' },
  rowDate: { fontSize: 13, color: GRAY, direction: 'ltr' },
  rowText: { fontSize: 14.5, color: TEXT, marginRight: 'auto' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 },
  modal: { width: '100%', maxWidth: 440, background: '#fff', borderRadius: 18, padding: 26, fontFamily: FONT },
  modalTitle: { fontFamily: "'Tajawal', sans-serif", fontWeight: 800, fontSize: 21, color: INK, margin: 0 },
  modalSub: { fontSize: 14, color: GRAY, margin: '8px 0 16px', lineHeight: 1.7 },
  field: { display: 'block', marginBottom: 12 },
  flbl: { display: 'block', fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 6 },
  input: { width: '100%', border: `1px solid ${LINE}`, borderRadius: 10, padding: '11px 12px', fontSize: 15, fontFamily: FONT, color: INK },
  err: { color: '#C0392B', fontSize: 13.5, marginTop: 4 },
  cancel: { width: '100%', background: 'transparent', border: 'none', color: GRAY, fontWeight: 600, fontSize: 14, cursor: 'pointer', marginTop: 8, fontFamily: FONT },
};
