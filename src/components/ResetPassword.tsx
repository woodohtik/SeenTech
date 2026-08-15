import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle,
  Loader2,
  ShieldCheck,
  Globe,
  Home,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { getAuthErrorMessage } from '../utils/authErrorUtils';
import { cn } from '../lib/utils';
import { IconInput } from './ui/IconInput';
import Branding from './Branding';

// How long to wait for detectSessionInUrl to establish a recovery session
// from the email link's tokens before treating the link as invalid/expired.
const LINK_TIMEOUT_MS = 8000;

export default function ResetPassword() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid'>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);

  const languages = [
    { code: 'ar', name: 'العربية' },
    { code: 'en', name: 'English' },
    { code: 'ur', name: 'اردو' },
  ];
  const currentLanguage = languages.find(l => l.code === i18n.language) || languages[0];
  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code);
    document.documentElement.dir = code === 'en' ? 'ltr' : 'rtl';
    document.documentElement.lang = code;
    setIsLangMenuOpen(false);
  };

  useEffect(() => {
    // detectSessionInUrl establishes a recovery session from the link's
    // tokens; PASSWORD_RECOVERY fires once that's done (a session may also
    // already be present by the time this effect runs).
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setStatus('ready');
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setStatus('ready');
    });

    const timeout = setTimeout(() => {
      setStatus(prev => (prev === 'checking' ? 'invalid' : prev));
    }, LINK_TIMEOUT_MS);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const getPasswordStrength = (pass: string) => {
    if (!pass) return 0;
    let strength = 0;
    if (pass.length >= 8) strength += 1;
    if (/[A-Z]/.test(pass)) strength += 1;
    if (/[0-9]/.test(pass)) strength += 1;
    if (/[^A-Za-z0-9]/.test(pass)) strength += 1;
    return strength;
  };
  const strength = getPasswordStrength(password);
  const strengthLabels = [
    t('login.strength.weak'),
    t('login.strength.medium'),
    t('login.strength.good'),
    t('login.strength.strong'),
  ];
  const strengthColors = ['bg-danger', 'bg-warning', 'bg-brand', 'bg-success'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError(t('login.errors.weak_password'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('saas.passwords_do_not_match'));
      return;
    }

    setLoading(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) throw updateErr;
      setSuccess(true);
      setTimeout(() => navigate('/login', { replace: true }), 2200);
    } catch (err: any) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-surface-muted font-sans relative">
      {/* Top Bar: Back to Landing Page & Language Switcher */}
      <div className="absolute top-4 left-4 right-4 z-50 flex items-center justify-between pointer-events-none">
        <button
          onClick={() => navigate('/')}
          title={t('login.back_to_landing')}
          aria-label={t('login.back_to_landing')}
          className="pointer-events-auto p-3 bg-surface hover:bg-brand border border-border hover:border-brand rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 text-content hover:text-white cursor-pointer group flex items-center justify-center active:scale-95"
        >
          <Home size={20} className="transition-all duration-300 group-hover:scale-110 text-current" />
        </button>

        <div className="pointer-events-auto relative">
          <button
            onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
            className="flex items-center gap-2 bg-surface px-4 py-2 rounded-xl shadow-sm border border-border hover:bg-surface-muted transition-colors cursor-pointer"
          >
            <Globe size={18} className="text-brand" />
            <span className="text-sm font-bold text-content">{currentLanguage.name}</span>
          </button>

          <AnimatePresence>
            {isLangMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute top-full mt-2 right-0 bg-surface rounded-xl shadow-xl border border-border overflow-hidden min-w-[140px]"
              >
                {languages.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => changeLanguage(lang.code)}
                    className={cn(
                      "w-full text-right px-4 py-3 text-sm font-medium hover:bg-surface-muted transition-colors flex items-center justify-between",
                      i18n.language === lang.code ? "text-brand bg-brand/5" : "text-content-muted"
                    )}
                  >
                    <span>{lang.name}</span>
                    {i18n.language === lang.code && <div className="w-1.5 h-1.5 rounded-full bg-brand" />}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Left Side - Visual */}
      <div className="hidden lg:flex lg:w-1/2 bg-brand p-12 items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 left-0 w-96 h-96 bg-surface rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl" />
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-brand/40 rounded-full translate-x-1/2 translate-y-1/2 blur-3xl" />
        </div>

        <div className="relative z-10 text-white max-w-lg text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="inline-block p-6 bg-white/10 backdrop-blur-xl rounded-[2.5rem] mb-8"
          >
            <ShieldCheck size={80} className="text-white" />
          </motion.div>
          <h1 className="text-5xl font-black mb-6 leading-tight">{t('login.reset_password_title')}</h1>
          <p className="text-xl text-white/80 font-medium leading-relaxed">
            {t('login.reset_password_subtitle')}
          </p>
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 md:p-12">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full max-w-md space-y-8"
        >
          <div className="text-center lg:text-right">
            <div className="lg:hidden inline-block p-4 bg-brand/10 rounded-2xl text-brand mb-6">
              <ShieldCheck size={32} />
            </div>
            <h2 className="text-3xl font-black text-content">{t('login.reset_password_title')}</h2>
            <p className="text-content-muted mt-2 font-medium">{t('login.reset_password_subtitle')}</p>
          </div>

          <AnimatePresence mode="wait">
            {status === 'checking' && (
              <motion.div
                key="checking"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center py-14"
              >
                <Loader2 className="animate-spin text-brand" size={32} />
              </motion.div>
            )}

            {status === 'invalid' && (
              <motion.div
                key="invalid"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="text-center space-y-6 py-4"
              >
                <div className="inline-flex items-center justify-center w-16 h-16 bg-danger/10 text-danger rounded-full">
                  <AlertCircle size={32} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-content">{t('login.reset_password_invalid_link')}</h3>
                  <p className="text-content-muted font-medium mt-2">{t('login.reset_password_invalid_link_desc')}</p>
                </div>
                <button
                  onClick={() => navigate('/login?view=forgot-password', { replace: true })}
                  className="w-full bg-brand text-white py-4 rounded-2xl font-bold text-lg hover:bg-brand/90 transition-all shadow-xl shadow-brand/10"
                >
                  {t('login.reset_password_back_to_forgot')}
                </button>
              </motion.div>
            )}

            {status === 'ready' && success && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-4 py-8"
              >
                <div className="inline-flex items-center justify-center w-20 h-20 bg-success/10 text-success rounded-full">
                  <CheckCircle size={40} />
                </div>
                <p className="text-content-muted font-medium leading-relaxed">{t('login.reset_password_success')}</p>
              </motion.div>
            )}

            {status === 'ready' && !success && (
              <motion.form
                key="form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                onSubmit={handleSubmit}
                className="space-y-5"
              >
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-danger/10 border border-danger/20 text-danger p-4 rounded-2xl flex items-center gap-3 text-sm font-bold"
                  >
                    <AlertCircle size={18} />
                    <span>{error}</span>
                  </motion.div>
                )}

                <IconInput
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  startIcon={Lock}
                  label={t('login.reset_password_new_password')}
                  wrapperClassName="h-11"
                  endIcon={
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-content-muted hover:text-content flex items-center justify-center p-1 focus:outline-none"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  }
                />

                {/* Strength Indicator */}
                <div className="px-1">
                  <div className="flex justify-between text-[10px] font-bold mb-1">
                    <span className="text-content-muted uppercase">{t('login.password_strength')}</span>
                    <span className={cn("uppercase", strength > 0 ? "text-brand" : "text-content-muted")}>
                      {password ? strengthLabels[strength - 1] : ''}
                    </span>
                  </div>
                  <div className="flex gap-1 h-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex-1 rounded-full transition-all duration-500",
                          strength >= i ? strengthColors[strength - 1] : "bg-surface-muted"
                        )}
                      />
                    ))}
                  </div>
                </div>

                <IconInput
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  startIcon={Lock}
                  label={t('login.reset_password_confirm_password')}
                  wrapperClassName="h-11"
                />

                <button
                  disabled={loading}
                  type="submit"
                  className="w-full bg-brand text-white py-4 rounded-2xl font-bold text-lg hover:bg-brand/90 transition-all shadow-xl shadow-brand/10 flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {loading ? <Loader2 className="animate-spin" /> : null}
                  <span>{t('login.reset_password_button')}</span>
                </button>
              </motion.form>
            )}
          </AnimatePresence>

          <div className="pt-4 flex flex-col items-center gap-3">
            <Branding className="opacity-50 mt-1" />
          </div>
        </motion.div>
      </div>
    </div>
  );
}
