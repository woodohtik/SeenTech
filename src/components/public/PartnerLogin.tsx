import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Handshake, Lock, Mail, Phone, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../../lib/supabase/client';
import { ensurePartnerReferralCode, registerReferralPartner } from '../../services/partnerReferralService';

type ViewMode = 'login' | 'register';

// نفس نظام تصميم صفحات المدونة الثابتة (scripts/blog/templates/shared.ts)
// حرفياً -- هدفها توحيد الهوية البصرية بين كل الصفحات العامة لسين (هبوط،
// مدونة، شريك إحالة)، لا اختراع لوحة جديدة. Tajawal/IBM Plex Sans Arabic
// مُحمَّلان محلياً فعلاً في index.html لكل التطبيق.
const STYLE = `
.pl-page{min-height:100vh;background:var(--pl-paper);display:flex;align-items:center;justify-content:center;padding:28px 18px;font-family:var(--pl-b)}
.pl-page *{box-sizing:border-box}
.pl-home{position:fixed;top:20px;inset-inline-start:20px;display:inline-flex;align-items:center;gap:7px;height:42px;padding:0 16px;border-radius:999px;background:#fff;border:1.5px solid var(--pl-line);color:var(--pl-ink);font-weight:700;font-size:14px;text-decoration:none;cursor:pointer;transition:border-color .2s}
.pl-home:hover{border-color:var(--pl-ink)}
.pl-card{width:100%;max-width:440px;background:#fff;border:1px solid var(--pl-line);border-radius:18px;box-shadow:0 10px 30px rgba(14,42,66,.08);overflow:hidden}
.pl-ruler{height:14px;background:
  repeating-linear-gradient(to left,var(--pl-ink) 0 1.5px,transparent 1.5px 60px) bottom/100% 14px no-repeat,
  repeating-linear-gradient(to left,var(--pl-ink) 0 1px,transparent 1px 30px) bottom/100% 9px no-repeat;opacity:.14}
.pl-body{padding:34px 32px 30px}
.pl-eyebrow{display:inline-flex;align-items:center;gap:9px;color:var(--pl-ink2);font-weight:600;font-size:14.5px;margin-bottom:16px}
.pl-eyebrow .ic{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:9px;background:var(--pl-tint);color:var(--pl-cta);flex:none}
.pl-card h1{font-family:var(--pl-h);font-weight:800;font-size:27px;color:var(--pl-ink);margin:0 0 8px;line-height:1.3}
.pl-lead{color:var(--pl-ink2);font-size:15.5px;line-height:1.7;margin:0 0 26px}
.pl-error{background:#FBEAEA;color:#A3312A;border:1px solid #F1CFCB;border-radius:12px;padding:12px 16px;font-size:14px;font-weight:600;margin-bottom:18px;line-height:1.6}
.pl-field{display:block;margin-bottom:14px}
.pl-field label{display:block;font-size:13.5px;font-weight:700;color:var(--pl-ink);margin-bottom:6px}
.pl-input-wrap{position:relative;display:flex;align-items:center;border:1.5px solid var(--pl-line);border-radius:12px;background:#fff;transition:border-color .2s}
.pl-input-wrap:focus-within{border-color:var(--pl-cta)}
.pl-input-wrap .lic{display:flex;align-items:center;padding-inline-start:14px;color:var(--pl-gray);flex:none}
.pl-input-wrap input{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:15px;color:var(--pl-ink);padding:12px 12px;outline:none}
.pl-input-wrap input::placeholder{color:#AAB6BF}
.pl-eye{display:flex;align-items:center;padding-inline-end:12px;color:var(--pl-gray);cursor:pointer;flex:none;background:none;border:0}
.pl-submit{width:100%;display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:50px;margin-top:8px;border-radius:999px;background:var(--pl-cta);color:#fff;font-family:var(--pl-b);font-weight:700;font-size:16px;border:0;cursor:pointer;transition:background .2s,transform .2s,opacity .2s}
.pl-submit:hover:not(:disabled){background:var(--pl-cta-hover);transform:translateY(-1px)}
.pl-submit:disabled{opacity:.6;cursor:not-allowed}
.pl-switch{text-align:center;color:var(--pl-gray);font-size:14.5px;margin-top:20px}
.pl-switch button{background:none;border:0;color:var(--pl-cta);font-weight:700;font-size:inherit;cursor:pointer;padding:0}
.pl-switch button:hover{color:var(--pl-cta-hover)}
`;

export default function PartnerLogin() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) throw signInErr;
      (window as any).refreshAuthData?.();
      navigate('/partner/referrals');
    } catch (err: any) {
      setError(err?.message?.includes('Invalid login credentials')
        ? t('partner_login.errors.invalid_credentials')
        : (err?.message || t('partner_login.errors.unknown')));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError(t('partner_login.errors.weak_password'));
      return;
    }
    setLoading(true);
    localStorage.setItem('is_registering', 'true');
    localStorage.setItem('is_registering_at', String(Date.now()));
    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name, phone } },
      });
      if (signUpError) throw signUpError;
      if (!signUpData.user) throw new Error(t('partner_login.errors.unknown'));

      let partnerId: string;
      try {
        partnerId = await registerReferralPartner(name, email, phone || null);
      } catch (regErr: any) {
        if (regErr?.code === '23505') {
          throw new Error(
            regErr.message?.includes('phone')
              ? t('partner_login.errors.phone_exists')
              : t('partner_login.errors.email_exists')
          );
        }
        throw regErr;
      }
      await ensurePartnerReferralCode(partnerId).catch(() => {});

      localStorage.removeItem('is_registering');
      (window as any).refreshAuthData?.();
      navigate('/partner/referrals');
    } catch (err: any) {
      localStorage.removeItem('is_registering');
      setError(err?.message || t('partner_login.errors.unknown'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="pl-page"
      style={{
        ['--pl-ink' as any]: '#0E2A42', ['--pl-ink2' as any]: '#28445c', ['--pl-paper' as any]: '#F6F7F8',
        ['--pl-line' as any]: '#DDE3E8', ['--pl-gray' as any]: '#5B6B79', ['--pl-cta' as any]: '#0F6E96',
        ['--pl-cta-hover' as any]: '#0B5A7B', ['--pl-tint' as any]: '#EAF3F8',
        ['--pl-h' as any]: "'Tajawal',system-ui,sans-serif", ['--pl-b' as any]: "'IBM Plex Sans Arabic',system-ui,sans-serif",
      }}
    >
      <style>{STYLE}</style>
      <button onClick={() => navigate('/')} className="pl-home" aria-label={t('partner_login.back_to_landing')}>
        <ArrowRight size={16} style={{ transform: 'scaleX(-1)' }} />
        {t('partner_login.back_to_landing')}
      </button>

      <div className="pl-card">
        <div className="pl-ruler" aria-hidden="true" />
        <div className="pl-body">
          <div className="pl-eyebrow">
            <span className="ic"><Handshake size={16} /></span>
            {t('partner_login.title')}
          </div>
          <h1>{view === 'login' ? t('partner_login.subtitle_login') : t('partner_login.subtitle_register')}</h1>
          <p className="pl-lead">
            {view === 'login' ? t('partner_login.lead_login', 'تابع رابطك ومكافآتك من هنا.') : t('partner_login.lead_register', 'بريدك وجوالك، وابدأ بمشاركة رابطك فوراً.')}
          </p>

          {error && <div className="pl-error" role="alert">{error}</div>}

          {view === 'login' ? (
            <form onSubmit={handleLogin}>
              <label className="pl-field">
                <label>{t('partner_login.email')}</label>
                <div className="pl-input-wrap">
                  <span className="lic"><Mail size={17} /></span>
                  <input required type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@mail.com" />
                </div>
              </label>
              <label className="pl-field">
                <label>{t('partner_login.password')}</label>
                <div className="pl-input-wrap">
                  <span className="lic"><Lock size={17} /></span>
                  <input required type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                  <button type="button" className="pl-eye" onClick={() => setShowPassword(!showPassword)} aria-label={t('partner_login.password')}>
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>
              <button type="submit" className="pl-submit" disabled={loading}>{loading ? t('partner_referral.loading') : t('partner_login.login_button')}</button>
              <p className="pl-switch">
                {t('partner_login.no_account')}{' '}
                <button type="button" onClick={() => setView('register')}>{t('partner_login.create_account')}</button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleRegister}>
              <label className="pl-field">
                <label>{t('partner_login.name')}</label>
                <div className="pl-input-wrap">
                  <span className="lic"><User size={17} /></span>
                  <input required type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('partner_login.name')} />
                </div>
              </label>
              <label className="pl-field">
                <label>{t('partner_login.email')}</label>
                <div className="pl-input-wrap">
                  <span className="lic"><Mail size={17} /></span>
                  <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@mail.com" />
                </div>
              </label>
              <label className="pl-field">
                <label>{t('partner_login.phone')}</label>
                <div className="pl-input-wrap">
                  <span className="lic"><Phone size={17} /></span>
                  <input type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xxxxxxxx" />
                </div>
              </label>
              <label className="pl-field">
                <label>{t('partner_login.password')}</label>
                <div className="pl-input-wrap">
                  <span className="lic"><Lock size={17} /></span>
                  <input required type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                  <button type="button" className="pl-eye" onClick={() => setShowPassword(!showPassword)} aria-label={t('partner_login.password')}>
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>
              <button type="submit" className="pl-submit" disabled={loading}>{loading ? t('partner_referral.sending') : t('partner_login.register_button')}</button>
              <p className="pl-switch">
                {t('partner_login.have_account')}{' '}
                <button type="button" onClick={() => setView('login')}>{t('partner_login.login_button')}</button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
