import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, User, Phone, Home, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../../lib/supabase/client';
import { IconInput } from '../ui/IconInput';
import { Button } from '../ui/Button';
import { ensurePartnerReferralCode, registerReferralPartner } from '../../services/partnerReferralService';

type ViewMode = 'login' | 'register';

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
    // يمنع resolveIdentity العامة (AuthContext) من تحليل الهوية قبل اكتمال
    // إنشاء صف referral_partners -- نفس آلية Login.tsx's handleRegister تماماً
    // (سباق فعلي: onAuthStateChange يتفعّل فور signUp، قبل أن ينتهي الإدراج).
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
    <div className="min-h-screen flex items-center justify-center bg-surface-muted font-sans relative p-6">
      <button
        onClick={() => navigate('/')}
        title={t('partner_login.back_to_landing')}
        aria-label={t('partner_login.back_to_landing')}
        className="absolute top-4 left-4 p-3 bg-surface hover:bg-brand border border-border hover:border-brand rounded-2xl shadow-sm hover:shadow-md transition-all text-content hover:text-white cursor-pointer flex items-center justify-center"
      >
        <Home size={20} />
      </button>

      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-black text-content">{t('partner_login.title')}</h2>
          <p className="text-content-muted mt-2 font-medium">
            {view === 'login' ? t('partner_login.subtitle_login') : t('partner_login.subtitle_register')}
          </p>
        </div>

        {error && (
          <div role="alert" className="bg-danger/10 border border-danger/20 text-danger p-4 rounded-2xl text-sm font-bold">
            {error}
          </div>
        )}

        {view === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-5">
            <IconInput required type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="example@mail.com" startIcon={Mail} label={t('partner_login.email')} wrapperClassName="h-11" />
            <IconInput required type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" startIcon={Lock} label={t('partner_login.password')}
              wrapperClassName="h-11"
              endIcon={
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-content-muted hover:text-content p-1">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              } />
            <Button type="submit" loading={loading} className="w-full h-14 text-lg">{t('partner_login.login_button')}</Button>
            <p className="text-center text-content-muted font-medium">
              {t('partner_login.no_account')}{' '}
              <button type="button" onClick={() => setView('register')} className="text-brand font-bold hover:underline">
                {t('partner_login.create_account')}
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4">
            <IconInput required type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder={t('partner_login.name')} startIcon={User} label={t('partner_login.name')} wrapperClassName="h-11" />
            <IconInput required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="example@mail.com" startIcon={Mail} label={t('partner_login.email')} wrapperClassName="h-11" />
            <IconInput type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="05xxxxxxxx" startIcon={Phone} label={t('partner_login.phone')} wrapperClassName="h-11" />
            <IconInput required type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" startIcon={Lock} label={t('partner_login.password')}
              wrapperClassName="h-11"
              endIcon={
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-content-muted hover:text-content p-1">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              } />
            <Button type="submit" loading={loading} className="w-full h-14 text-lg mt-4">
              {!loading && <Send size={20} />}
              {t('partner_login.register_button')}
            </Button>
            <p className="text-center text-content-muted font-medium">
              {t('partner_login.have_account')}{' '}
              <button type="button" onClick={() => setView('login')} className="text-brand font-bold hover:underline">
                {t('partner_login.login_button')}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
