/**
 * PartnerReferrals — لوحة برنامج إحالة الشركاء (حساب مستقل عن حسابات التجار)
 * ---------------------------------------------------------------------------
 * التصميم مبني على ألوان/خطوط صفحات المدونة الثابتة (scripts/blog/templates/shared.ts:
 * --ink/--paper/--sky/--cta/Tajawal+IBM Plex Sans Arabic) لتوحيد الهوية البصرية
 * العامة، لكن مع معالجة أغنى (تدرّج وعمق وتوهّج) تناسب طابع محفظة/مكافآت مالية
 * بدل الطابع التحريري المسطّح للمدونة. لا منطق بيانات جديد هنا، فقط طبقة
 * العرض؛ كل استدعاءات partnerReferralService.ts كما هي.
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
import { Copy, Handshake, Link2, LogOut, MessageCircleMore, Receipt, Users } from 'lucide-react';
import i18n from 'i18next';
import { useDirection } from '../../lib/direction';
import { useToast } from '../../contexts/ToastContext';

const STYLE = `
.pr-page{--i:#0E2A42;--i2:#28445c;--i3:#15395A;--paper:#F3F5F7;--line:#E3E8EC;--gray:#5B6B79;--sky:#33C2F1;--cta:#0F6E96;--cta-h:#0B5A7B;--tint:#EAF3F8;--gold:#E8A33D;--gold-d:#9A6B1E;--gold-tint:#FBF2E3;--h:'Tajawal',system-ui,sans-serif;--b:'IBM Plex Sans Arabic',system-ui,sans-serif;
  min-height:100vh;background:
    radial-gradient(900px 500px at 15% -10%, rgba(15,110,150,.06), transparent),
    radial-gradient(700px 420px at 100% 0%, rgba(51,194,241,.07), transparent),
    var(--paper);
  font-family:var(--b);color:var(--i);padding:32px 18px 64px}
.pr-page *{box-sizing:border-box}
.pr-wrap{width:min(900px,100%);margin-inline:auto}
.pr-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:24px;flex-wrap:wrap}
.pr-eyebrow{display:inline-flex;align-items:center;gap:9px;color:var(--i2);font-weight:700;font-size:14.5px}
.pr-eyebrow .ic{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:10px;background:linear-gradient(135deg,var(--tint),#fff);color:var(--cta);box-shadow:0 2px 6px rgba(15,110,150,.18)}
.pr-logout{display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 16px;border-radius:999px;background:#fff;border:1px solid var(--line);color:var(--i);font-weight:700;font-size:13.5px;cursor:pointer;box-shadow:0 1px 3px rgba(14,42,66,.06);transition:border-color .2s,box-shadow .2s}
.pr-logout:hover{border-color:var(--i);box-shadow:0 3px 10px rgba(14,42,66,.1)}

.pr-hero{position:relative;overflow:hidden;background:linear-gradient(150deg,var(--i) 0%,var(--i3) 55%,#1C4A72 100%);color:#fff;border-radius:24px;padding:36px 32px;margin-bottom:20px;box-shadow:0 20px 48px -12px rgba(14,42,66,.45)}
.pr-hero .glow-a{position:absolute;width:280px;height:280px;border-radius:50%;background:var(--sky);opacity:.22;filter:blur(70px);top:-110px;inset-inline-end:-70px;pointer-events:none}
.pr-hero .glow-b{position:absolute;width:220px;height:220px;border-radius:50%;background:var(--gold);opacity:.14;filter:blur(80px);bottom:-100px;inset-inline-start:-60px;pointer-events:none}
.pr-hero-top{display:flex;align-items:center;justify-content:space-between;gap:12px;position:relative}
.pr-hero-lbl{font-size:14.5px;color:#BFD3E3;font-weight:600;letter-spacing:.01em}
.pr-hero-badge{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#0E2A42;background:linear-gradient(135deg,#FFE1A6,var(--gold));padding:6px 13px;border-radius:999px;box-shadow:0 3px 10px rgba(232,163,61,.35)}
.pr-hero-n{position:relative;font-family:var(--h);font-weight:800;font-size:clamp(42px,6.5vw,60px);color:#fff;line-height:1;display:flex;align-items:baseline;gap:9px;margin-top:14px;text-shadow:0 2px 18px rgba(51,194,241,.35)}
.pr-hero-n b{color:var(--sky)}
.pr-hero-n small{font-size:19px;color:#BFD3E3;font-weight:600}
.pr-bar{position:relative;height:8px;border-radius:999px;background:rgba(255,255,255,.14);margin-top:20px;overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.25)}
.pr-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--cta),var(--sky));border-radius:999px;box-shadow:0 0 14px rgba(51,194,241,.6)}
.pr-bar-note{position:relative;font-size:13.5px;color:#CFE0ED;margin-top:10px;font-weight:500}
.pr-hero-foot{position:relative;display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;margin-top:26px;padding-top:20px;border-top:1px solid rgba(255,255,255,.14)}
.pr-hero-earned{font-size:13.5px;color:#BFD3E3}
.pr-hero-earned b{color:#fff;font-weight:700}
.pr-cta{display:inline-flex;align-items:center;gap:8px;height:48px;padding:0 24px;border-radius:999px;background:#fff;color:var(--i);font-weight:800;font-size:15px;font-family:var(--b);border:0;cursor:pointer;box-shadow:0 10px 24px -6px rgba(0,0,0,.35);transition:transform .2s,box-shadow .2s,opacity .2s}
.pr-cta:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 14px 28px -6px rgba(0,0,0,.4)}
.pr-cta:disabled{opacity:.4;cursor:not-allowed;box-shadow:none}

.pr-notice{background:linear-gradient(135deg,var(--tint),#fff);border:1px solid #D7E7F0;border-inline-start:4px solid var(--cta);border-radius:16px;padding:16px 20px;font-size:14.5px;color:var(--i2);line-height:1.7;margin-bottom:18px;box-shadow:0 4px 14px rgba(14,42,66,.05)}

.pr-grid{display:grid;gap:16px;margin-bottom:16px}
@media(min-width:700px){.pr-grid{grid-template-columns:1.1fr .9fr}}
.pr-card{background:#fff;border:1px solid var(--line);border-radius:20px;padding:26px;margin-bottom:16px;box-shadow:0 8px 28px -10px rgba(14,42,66,.14);transition:box-shadow .25s,transform .25s}
.pr-card:hover{box-shadow:0 14px 36px -10px rgba(14,42,66,.2)}
.pr-grid .pr-card{margin-bottom:0}
.pr-card h2{display:flex;align-items:center;gap:9px;font-family:var(--h);font-weight:800;font-size:17.5px;margin:0 0 16px;color:var(--i)}
.pr-card h2 .ic{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--tint);color:var(--cta);flex:none}
.pr-link-row{display:flex;gap:8px;flex-wrap:wrap}
.pr-link-input{flex:1;min-width:150px;border:1.5px solid var(--line);border-radius:12px;padding:13px 15px;font-size:14px;background:var(--paper);color:var(--i);direction:ltr;text-align:left;font-weight:600}
.pr-pill-btn{display:inline-flex;align-items:center;gap:7px;height:48px;padding:0 20px;border-radius:999px;border:1.5px solid var(--line);background:#fff;color:var(--i);font-weight:700;font-size:14.5px;cursor:pointer;white-space:nowrap;transition:border-color .2s,box-shadow .2s,transform .2s}
.pr-pill-btn:hover:not(:disabled){border-color:var(--cta);color:var(--cta);box-shadow:0 6px 16px -4px rgba(15,110,150,.25);transform:translateY(-1px)}
.pr-pill-btn:disabled{opacity:.5;cursor:not-allowed}
.pr-pill-btn.wa{background:linear-gradient(135deg,#2CDB7B,#1EBE64);border-color:transparent;color:#fff;margin-top:12px;width:100%;justify-content:center;box-shadow:0 8px 20px -6px rgba(37,211,102,.5)}
.pr-pill-btn.wa:hover{color:#fff;box-shadow:0 10px 24px -6px rgba(37,211,102,.6)}
.pr-hint{font-size:13px;color:var(--gray);margin-top:12px;line-height:1.7}
.pr-empty{color:var(--gray);font-size:14.5px;padding:20px 0;text-align:center}
.pr-row{display:flex;align-items:center;gap:13px;padding:14px 2px;border-top:1px solid var(--line)}
.pr-row:first-child{border-top:0}
.pr-chip{font-weight:700;font-size:12.5px;border-radius:999px;padding:6px 14px;flex:none;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.pr-row-date{font-size:13px;color:var(--gray);direction:ltr;font-weight:500}
.pr-row-text{font-size:14.5px;color:var(--i2);margin-inline-start:auto;font-weight:600}

.pr-overlay{position:fixed;inset:0;background:rgba(14,42,66,.6);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:18px;z-index:2000}
.pr-modal{width:100%;max-width:440px;background:#fff;border-radius:22px;padding:30px;box-shadow:0 30px 70px -15px rgba(0,0,0,.4)}
.pr-modal h3{font-family:var(--h);font-weight:800;font-size:21px;margin:0 0 6px;color:var(--i)}
.pr-modal .lead{font-size:14px;color:var(--gray);line-height:1.7;margin-bottom:20px}
.pr-field{display:block;margin-bottom:14px}
.pr-field label{display:block;font-size:13.5px;font-weight:700;margin-bottom:6px;color:var(--i)}
.pr-field input{width:100%;border:1.5px solid var(--line);border-radius:12px;padding:12px 14px;font-size:15px;color:var(--i);font:inherit;transition:border-color .2s}
.pr-field input:focus{outline:none;border-color:var(--cta);box-shadow:0 0 0 3px rgba(15,110,150,.12)}
.pr-err{color:#A3312A;font-size:13.5px;margin-top:4px;font-weight:600}
.pr-cancel{width:100%;background:none;border:0;color:var(--gray);font-weight:600;font-size:14px;cursor:pointer;margin-top:12px;padding:8px 0}
`;

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
    <div className="pr-page" dir={dir}>
      <style>{STYLE}</style>
      <div className="pr-wrap">
        <div className="pr-top">
          <span className="pr-eyebrow"><span className="ic"><Handshake size={14} /></span>{t('partner_referral.title')}</span>
          <button className="pr-logout" onClick={() => logout()}><LogOut size={15} />{t('partner_referral.logout', 'تسجيل خروج')}</button>
        </div>

        {!loading && !programSettings.enabled && (
          <div className="pr-notice">{t('partner_referral.program_disabled_notice', 'برنامج إحالة الشركاء متوقف مؤقتاً عن استقبال إحالات جديدة -- يمكنك متابعة سحب رصيدك الحالي كالمعتاد.')}</div>
        )}

        <div className="pr-hero">
          <span className="glow-a" aria-hidden="true" />
          <span className="glow-b" aria-hidden="true" />
          <div className="pr-hero-top">
            <div className="pr-hero-lbl">{t('partner_referral.wallet_balance')}</div>
            {canWithdraw && <span className="pr-hero-badge">✓ {t('partner_referral.ready_to_withdraw')}</span>}
          </div>
          <div className="pr-hero-n">{wallet.balance.toLocaleString('en-US')} <small><CurrencySymbol className="h-[0.85em] w-auto inline-block" /></small></div>
          <div className="pr-bar"><i style={{ width: `${pct}%` }} /></div>
          <div className="pr-bar-note">
            {canWithdraw
              ? t('partner_referral.ready_to_withdraw')
              : t('partner_referral.remaining_to_withdraw', { amount: (minWithdrawal - wallet.balance).toLocaleString('en-US'), min: minWithdrawal })}
          </div>
          <div className="pr-hero-foot">
            <span className="pr-hero-earned">{t('partner_referral.total_earned', { amount: wallet.total_earned.toLocaleString('en-US'), refs: refs.length })}</span>
            <button className="pr-cta" disabled={!canWithdraw} onClick={() => setShowModal(true)}>{t('partner_referral.request_transfer')}</button>
          </div>
        </div>

        <div className="pr-grid">
          <div className="pr-card">
            <h2><span className="ic"><Link2 size={16} /></span>{t('partner_referral.your_link')}</h2>
            <div className="pr-link-row">
              <input readOnly value={link} className="pr-link-input" />
              <button onClick={copy} disabled={!programSettings.enabled} className="pr-pill-btn"><Copy size={15} />{copied ? t('billing.modal_iban_copied') : t('common.copy')}</button>
            </div>
            <button onClick={shareWhatsApp} disabled={!programSettings.enabled} className="pr-pill-btn wa"><MessageCircleMore size={16} />{t('partner_referral.share_whatsapp')}</button>
            <p className="pr-hint">{t('partner_referral.link_hint', { reward: programSettings.rewardPerReferral })}</p>
          </div>

          <div className="pr-card">
            <h2><span className="ic"><Users size={16} /></span>{t('partner_referral.summary_title', 'ملخص الإحالات')}</h2>
            <div style={{ display: 'flex', gap: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--h)', fontWeight: 800, fontSize: 30, color: 'var(--i)' }}>{refs.filter(r => r.status === 'credited').length}</div>
                <div style={{ fontSize: 13, color: 'var(--gray)', fontWeight: 600 }}>{i18n.t('partner_referral.status.credited_text')}</div>
              </div>
              <div style={{ width: 1, background: 'var(--line)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--h)', fontWeight: 800, fontSize: 30, color: 'var(--gold-d)' }}>{refs.filter(r => r.status === 'pending').length}</div>
                <div style={{ fontSize: 13, color: 'var(--gray)', fontWeight: 600 }}>{i18n.t('partner_referral.status.pending_label')}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="pr-card">
          <h2><span className="ic"><Users size={16} /></span>{t('partner_referral.your_referrals', { n: refs.length })}</h2>
          {loading ? <div className="pr-empty">{t('partner_referral.loading')}</div> :
            refs.length === 0 ? <div className="pr-empty">{t('partner_referral.no_referrals')}</div> :
            refs.map(r => { const rs = refStatus(r); return (
              <div key={r.id} className="pr-row">
                <span className="pr-chip" style={{ background: rs.bg, color: rs.fg }}>{rs.label}</span>
                <span className="pr-row-date">{new Date(r.created_at).toLocaleDateString('en-GB')}</span>
                <span className="pr-row-text">{rs.text}</span>
              </div>
            ); })}
        </div>

        {withdrawals.length > 0 && (
          <div className="pr-card">
            <h2><span className="ic"><Receipt size={16} /></span>{t('saas.menu_withdrawals')}</h2>
            {withdrawals.map(w => (
              <div key={w.id} className="pr-row">
                <span className="pr-chip" style={{ background: wStatusColor(w.status).bg, color: wStatusColor(w.status).fg }}>{wStatusLabel(w.status)}</span>
                <span className="pr-row-date">{new Date(w.requested_at).toLocaleDateString('en-GB')}</span>
                <span className="pr-row-text">{w.amount.toLocaleString('en-US')} ﷼</span>
              </div>
            ))}
          </div>
        )}
      </div>

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
    <div dir={dir} className="pr-overlay">
      <div className="pr-modal">
        <h3>{t('partner_referral.withdraw_modal_title')}</h3>
        <p className="lead">{t('partner_referral.withdraw_modal_subtitle')}</p>
        <label className="pr-field"><label>{t('partner_referral.beneficiary_name')}</label>
          <input value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="pr-field"><label>{t('partner_referral.iban')}</label>
          <input value={iban} onChange={e => setIban(e.target.value)} placeholder="SAxxxxxxxxxxxxxxxxxxxxxx" dir="ltr" /></label>
        <label className="pr-field"><label>{t('partner_referral.amount_sar')}</label>
          <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value) || 0)} /></label>
        {err && <div className="pr-err">{err}</div>}
        <button onClick={submit} disabled={busy} className="pr-cta" style={{ width: '100%', marginTop: 8, background: '#0F6E96', color: '#fff' }}>
          {busy ? t('partner_referral.sending') : t('partner_referral.send_request')}</button>
        <button onClick={onClose} className="pr-cancel">{t('common.cancel')}</button>
      </div>
    </div>
  );
}

function refStatus(r: PartnerReferralRow): { label: string; text: string; bg: string; fg: string } {
  const expiredByTime = r.status === 'pending' && r.qualified_until && new Date(r.qualified_until).getTime() < Date.now();
  if (r.status === 'credited') return { label: `+${r.reward_amount} ﷼`, text: i18n.t('partner_referral.status.credited_text'), bg: '#E7F7EE', fg: '#0A8A5C' };
  if (r.status === 'expired' || expiredByTime) return { label: i18n.t('partner_referral.status.expired_label'), text: i18n.t('partner_referral.status.expired_text'), bg: '#EEF1F4', fg: '#5B6B79' };
  if (r.status === 'rejected') return { label: i18n.t('inventory.status_rejected'), text: i18n.t('partner_referral.status.rejected_text'), bg: '#FBEAEA', fg: '#A3312A' };
  return { label: i18n.t('partner_referral.status.pending_label'), text: i18n.t('partner_referral.status.pending_text'), bg: '#FBEAD0', fg: '#B9770E' };
}
function wStatusLabel(s: string) { return s === 'paid' ? i18n.t('partner_referral.withdrawal.paid') : s === 'pending' ? i18n.t('partner_referral.withdrawal.pending') : s === 'approved' ? i18n.t('partner_referral.withdrawal.approved') : i18n.t('saas.rejection_reason_default'); }
function wStatusColor(s: string) { return s === 'paid' ? { bg: '#E7F7EE', fg: '#0A8A5C' } : s === 'rejected' ? { bg: '#FBEAEA', fg: '#A3312A' } : { bg: '#EAF3F8', fg: '#0F6E96' }; }
