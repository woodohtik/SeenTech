/**
 * PartnerReferrals — لوحة برنامج إحالة الشركاء (حساب مستقل عن حسابات التجار)
 * ---------------------------------------------------------------------------
 * نسخة من Referral.tsx بالتصميم المرئي نفسه، لكن تحصل على partnerId بنفسها
 * (عبر uid الجلسة الحالية) بدل الحصول عليه كـprop، وتستخدم partnerReferralService.ts
 * الموازي بدل referralService.ts الأصلي.
 * التوصيل: <Route path="/partner/referrals" element={<PartnerReferrals />} /> (App.tsx)
 */

import { useEffect, useState } from 'react';
import {
  ensurePartnerReferralCode, partnerReferralLink, getPartnerWallet, listPartnerReferrals,
  listMyPartnerWithdrawals, requestPartnerWithdrawal, getPartnerReferralProgramSettings,
  MIN_PARTNER_WITHDRAWAL, REWARD_PER_PARTNER_REFERRAL,
  type PartnerWallet, type PartnerReferralRow, type PartnerWithdrawal, type PartnerReferralProgramSettings,
} from '../../services/partnerReferralService';
import { supabase } from '../../lib/supabase/client';
import { useAuth } from '../../contexts/AuthContext';
import { CurrencySymbol } from '../CurrencySymbol';
import i18n from 'i18next';
import { useDirection } from '../../lib/direction';
import { useToast } from '../../contexts/ToastContext';

const INK = '#0E2A42', BRAND = '#34BBED', CTA = '#0BA06B', CTA2 = '#0A8A5C';
const SURF = 'var(--surface-muted)', GRAY = 'var(--content-muted)', TEXT = '#34404D', LINE = 'var(--border)', MINT = '#E7F7EE', TINT = '#EAF6FD';

export default function PartnerReferrals() {
  const { t, dir } = useDirection();
  const { handleError } = useToast();
  const { session, logout } = useAuth();
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [wallet, setWallet] = useState<PartnerWallet>({ balance: 0, total_earned: 0 });
  const [refs, setRefs] = useState<PartnerReferralRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<PartnerWithdrawal[]>([]);
  const [copied, setCopied] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [programSettings, setProgramSettings] = useState<PartnerReferralProgramSettings>({
    enabled: true, rewardPerReferral: REWARD_PER_PARTNER_REFERRAL, minWithdrawal: MIN_PARTNER_WITHDRAWAL,
  });

  async function load(pid: string) {
    setLoading(true);
    try {
      const code = await ensurePartnerReferralCode(pid);
      setLink(partnerReferralLink(code));
      const [w, r, wd, settings] = await Promise.all([
        getPartnerWallet(pid), listPartnerReferrals(pid), listMyPartnerWithdrawals(pid), getPartnerReferralProgramSettings(),
      ]);
      setWallet(w); setRefs(r); setWithdrawals(wd); setProgramSettings(settings);
    } catch (e) {
      console.warn('[partner-referral] load failed', e);
      handleError(e, t('partner_referral.load_failed', 'تعذّر تحميل بيانات برنامج الإحالة'));
    }
    finally { setLoading(false); }
  }

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    supabase.from('referral_partners').select('id').eq('uid', uid).maybeSingle().then(({ data }) => {
      if (data?.id) {
        setPartnerId(data.id);
        load(data.id);
      } else {
        setLoading(false);
      }
    });
    // eslint-disable-next-line
  }, [session?.user?.id]);

  function copy() {
    navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
  }
  function shareWhatsApp() {
    const msg = t('partner_referral.whatsapp_share_text', { link });
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }

  const minWithdrawal = programSettings.minWithdrawal;
  const pct = Math.min(100, Math.round((wallet.balance / minWithdrawal) * 100));
  const canWithdraw = wallet.balance > minWithdrawal;

  return (
    <div dir={dir} style={s.wrap}>
      <div style={s.head}>
        <div>
          <h2 style={s.title}>{t('partner_referral.title')}</h2>
          <p style={s.sub}>{t('partner_referral.subtitle', { reward: programSettings.rewardPerReferral })}</p>
        </div>
        <button onClick={() => logout()} style={s.logoutBtn}>{t('partner_referral.logout', 'تسجيل خروج')}</button>
      </div>

      {!loading && !programSettings.enabled && (
        <div style={s.disabledNotice}>{t('partner_referral.program_disabled_notice', 'برنامج إحالة الشركاء متوقف مؤقتاً عن استقبال إحالات جديدة -- يمكنك متابعة سحب رصيدك الحالي كالمعتاد.')}</div>
      )}

      <div style={s.grid}>
        <div style={{ ...s.card, ...s.walletCard }}>
          <div style={s.cardLbl}>{t('partner_referral.wallet_balance')}</div>
          <div style={s.balance}>{wallet.balance.toLocaleString('en-US')} <span style={s.cur}><CurrencySymbol className="h-[0.9em] w-auto inline-block" /></span></div>
          <div style={s.barTrack}><div style={{ ...s.barFill, width: `${pct}%` }} /></div>
          <div style={s.barNote}>
            {canWithdraw
              ? t('partner_referral.ready_to_withdraw')
              : t('partner_referral.remaining_to_withdraw', { amount: (minWithdrawal - wallet.balance).toLocaleString('en-US'), min: minWithdrawal })}
          </div>
          <button disabled={!canWithdraw} onClick={() => setShowModal(true)}
            style={{ ...s.cta, ...(canWithdraw ? {} : s.ctaDisabled) }}>{t('partner_referral.request_transfer')}</button>
          <div style={s.earned}>{t('partner_referral.total_earned', { amount: wallet.total_earned.toLocaleString('en-US'), refs: refs.length })}</div>
        </div>

        <div style={s.card}>
          <div style={s.cardLbl}>{t('partner_referral.your_link')}</div>
          <div style={s.linkRow}>
            <input readOnly value={link} style={s.linkInput} dir="ltr" />
            <button onClick={copy} disabled={!programSettings.enabled} style={{ ...s.copyBtn, ...(programSettings.enabled ? {} : s.ctaDisabled) }}>{copied ? t('billing.modal_iban_copied') : t('common.copy')}</button>
          </div>
          <button onClick={shareWhatsApp} disabled={!programSettings.enabled} style={{ ...s.waBtn, ...(programSettings.enabled ? {} : s.ctaDisabled) }}>{t('partner_referral.share_whatsapp')}</button>
          <div style={s.hint}>{t('partner_referral.link_hint', { reward: programSettings.rewardPerReferral })}</div>
        </div>
      </div>

      <div style={{ ...s.card, marginTop: 18 }}>
        <div style={s.cardLbl}>{t('partner_referral.your_referrals', { n: refs.length })}</div>
        {loading ? <div style={s.empty}>{t('partner_referral.loading')}</div> :
          refs.length === 0 ? <div style={s.empty}>{t('partner_referral.no_referrals')}</div> :
          <div>{refs.map(r => { const rs = refStatus(r); return (
            <div key={r.id} style={s.rowItem}>
              <span style={{ ...s.badge, background: rs.bg, color: rs.fg }}>{rs.label}</span>
              <span style={s.rowDate}>{new Date(r.created_at).toLocaleDateString('en-GB')}</span>
              <span style={s.rowText}>{rs.text}</span>
            </div>
          ); })}</div>}
      </div>

      {withdrawals.length > 0 && (
        <div style={{ ...s.card, marginTop: 18 }}>
          <div style={s.cardLbl}>{t('saas.menu_withdrawals')}</div>
          {withdrawals.map(w => (
            <div key={w.id} style={s.rowItem}>
              <span style={{ ...s.badge, background: wStatusColor(w.status).bg, color: wStatusColor(w.status).fg }}>{wStatusLabel(w.status)}</span>
              <span style={s.rowDate}>{new Date(w.requested_at).toLocaleDateString('en-GB')}</span>
              <span style={s.rowText}>{w.amount.toLocaleString('en-US')} ﷼</span>
            </div>
          ))}
        </div>
      )}

      {showModal && partnerId && <WithdrawModal balance={wallet.balance} minWithdrawal={minWithdrawal} onClose={() => setShowModal(false)}
        onDone={() => { setShowModal(false); load(partnerId); }} partnerId={partnerId} />}
    </div>
  );
}

function WithdrawModal({ partnerId, balance, minWithdrawal, onClose, onDone }:
  { partnerId: string; balance: number; minWithdrawal: number; onClose: () => void; onDone: () => void }) {
  const { t, dir } = useDirection();
  const [iban, setIban] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState<number>(balance);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    if (!/^SA\d{22}$/.test(iban.replace(/\s/g, ''))) { setErr(t('partner_referral.invalid_iban')); return; }
    if (!name.trim()) { setErr(t('partner_referral.enter_beneficiary_name')); return; }
    if (amount <= minWithdrawal || amount > balance) { setErr(t('partner_referral.amount_range', { min: minWithdrawal, max: balance })); return; }
    setBusy(true);
    try { await requestPartnerWithdrawal(partnerId, amount, iban.replace(/\s/g, ''), name.trim()); onDone(); }
    catch (e: any) { setErr(e?.message || t('partner_referral.submit_failed')); setBusy(false); }
  }

  return (
    <div dir={dir} style={s.overlay}>
      <div style={s.modal}>
        <h3 style={s.modalTitle}>{t('partner_referral.withdraw_modal_title')}</h3>
        <p style={s.modalSub}>{t('partner_referral.withdraw_modal_subtitle')}</p>
        <label style={s.field}><span style={s.flbl}>{t('partner_referral.beneficiary_name')}</span>
          <input value={name} onChange={e => setName(e.target.value)} style={s.input} /></label>
        <label style={s.field}><span style={s.flbl}>{t('partner_referral.iban')}</span>
          <input value={iban} onChange={e => setIban(e.target.value)} placeholder="SAxxxxxxxxxxxxxxxxxxxxxx" dir="ltr" style={s.input} /></label>
        <label style={s.field}><span style={s.flbl}>{t('partner_referral.amount_sar')}</span>
          <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value) || 0)} style={s.input} /></label>
        {err && <div style={s.err}>{err}</div>}
        <button onClick={submit} disabled={busy} style={{ ...s.cta, marginTop: 8, ...(busy ? s.ctaDisabled : {}) }}>
          {busy ? t('partner_referral.sending') : t('partner_referral.send_request')}</button>
        <button onClick={onClose} style={s.cancel}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}

function refStatus(r: PartnerReferralRow): { label: string; text: string; bg: string; fg: string } {
  const expiredByTime = r.status === 'pending' && r.qualified_until && new Date(r.qualified_until).getTime() < Date.now();
  if (r.status === 'credited') return { label: `+${r.reward_amount} ﷼`, text: i18n.t('partner_referral.status.credited_text'), bg: MINT, fg: CTA2 };
  if (r.status === 'expired' || expiredByTime) return { label: i18n.t('partner_referral.status.expired_label'), text: i18n.t('partner_referral.status.expired_text'), bg: '#EEF1F4', fg: GRAY };
  if (r.status === 'rejected') return { label: i18n.t('inventory.status_rejected'), text: i18n.t('partner_referral.status.rejected_text'), bg: '#F7D9D5', fg: 'var(--danger)' };
  return { label: i18n.t('partner_referral.status.pending_label'), text: i18n.t('partner_referral.status.pending_text'), bg: '#FBEAD0', fg: '#B9770E' };
}
function wStatusLabel(s: string) { return s === 'paid' ? i18n.t('partner_referral.withdrawal.paid') : s === 'pending' ? i18n.t('partner_referral.withdrawal.pending') : s === 'approved' ? i18n.t('partner_referral.withdrawal.approved') : i18n.t('saas.rejection_reason_default'); }
function wStatusColor(s: string) { return s === 'paid' ? { bg: MINT, fg: CTA2 } : s === 'rejected' ? { bg: '#F7D9D5', fg: 'var(--danger)' } : { bg: TINT, fg: '#2E75B6' }; }

const s: Record<string, React.CSSProperties> = {
  wrap: { color: TEXT, padding: 24, maxWidth: 1000, margin: '0 auto' },
  head: { marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
  logoutBtn: { background: 'transparent', border: `1px solid ${LINE}`, color: GRAY, fontWeight: 700, fontSize: 13.5, borderRadius: 10, padding: '8px 16px', cursor: 'pointer' },
  disabledNotice: { background: '#FBEAD0', color: '#8A5A12', border: '1px solid #F0D9A8', borderRadius: 14, padding: '14px 18px', fontSize: 14, fontWeight: 700, marginBottom: 18, lineHeight: 1.7 },
  title: { fontFamily: "'Tajawal', sans-serif", fontWeight: 800, fontSize: 28, color: INK, margin: 0 },
  sub: { color: GRAY, fontSize: 15.5, margin: '6px 0 0' },
  grid: { display: 'flex', gap: 18, flexWrap: 'wrap' },
  card: { flex: '1 1 340px', background: 'var(--surface)', border: `1px solid ${LINE}`, borderRadius: 18, padding: 24, boxShadow: '0 8px 24px rgba(14,42,66,.06)' },
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
  linkInput: { flex: 1, border: `1px solid ${LINE}`, borderRadius: 12, padding: '11px 12px', fontSize: 13, background: SURF, color: INK },
  copyBtn: { background: INK, color: '#fff', border: 'none', borderRadius: 10, padding: '0 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  waBtn: { width: '100%', background: '#25D366', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginTop: 12 },
  hint: { fontSize: 13, color: GRAY, marginTop: 12, lineHeight: 1.7 },
  empty: { color: GRAY, fontSize: 14, padding: '14px 0' },
  rowItem: { display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: `1px solid ${LINE}` },
  badge: { fontWeight: 800, fontSize: 13, borderRadius: 8, padding: '4px 12px' },
  rowDate: { fontSize: 13, color: GRAY, direction: 'ltr' },
  rowText: { fontSize: 14.5, color: TEXT, marginInlineStart: 'auto' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 },
  modal: { width: '100%', maxWidth: 440, background: 'var(--surface)', borderRadius: 18, padding: 26 },
  modalTitle: { fontFamily: "'Tajawal', sans-serif", fontWeight: 800, fontSize: 21, color: INK, margin: 0 },
  modalSub: { fontSize: 14, color: GRAY, margin: '8px 0 16px', lineHeight: 1.7 },
  field: { display: 'block', marginBottom: 12 },
  flbl: { display: 'block', fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 6 },
  input: { width: '100%', border: `1px solid ${LINE}`, borderRadius: 12, padding: '11px 12px', fontSize: 15, color: INK },
  err: { color: 'var(--danger)', fontSize: 13.5, marginTop: 4 },
  cancel: { width: '100%', background: 'transparent', border: 'none', color: GRAY, fontWeight: 600, fontSize: 14, cursor: 'pointer', marginTop: 8 },
};
