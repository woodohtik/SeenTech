import React, { useState, useEffect } from 'react';
import { formatSaudiPhone, validateSaudiPhone } from '../utils/phoneUtils';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../contexts/AuthContext';
import {
  Scissors,
  Send,
  CheckCircle,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Phone,
  User,
  ArrowRight,
  AlertCircle,
  Loader2,
  Globe,
  Home,
  Terminal,
  Shield
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import Branding from './Branding';
import { IconInput } from './ui/IconInput';
import { getAuthErrorMessage } from '../utils/authErrorUtils';

type ViewMode = 'login' | 'register' | 'forgot-password' | 'reset-sent';

export default function Login() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user: authUser } = useAuth();
  const [view, setView] = useState<ViewMode>(() => {
    const mode = searchParams.get('view');
    if (mode === 'register') return 'register';
    if (mode === 'forgot-password') return 'forgot-password';
    return 'login';
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);

  // Form States
  const [loginId, setLoginId] = useState(''); // Email or Phone
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [googleUser, setGoogleUser] = useState<any>(null);

  const languages = [
    { code: 'ar', name: 'العربية', dir: 'rtl' },
    { code: 'en', name: 'English', dir: 'ltr' },
    { code: 'ur', name: 'اردو', dir: 'rtl' }
  ];

  const currentLanguage = languages.find(l => l.code === i18n.language) || languages[0];

  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code);
    const dir = code === 'en' ? 'ltr' : 'rtl';
    document.documentElement.dir = dir;
    document.documentElement.lang = code;
    setIsLangMenuOpen(false);
  };

  // Load remembered loginId and ensure Arabic is default if language is not set
  useEffect(() => {
    // Ensure Arabic is default if no language is selected or if cleared
    const currentLng = localStorage.getItem('i18nextLng');
    if (!currentLng || (currentLng !== 'ar' && currentLng !== 'en' && currentLng !== 'ur')) {
      localStorage.setItem('i18nextLng', 'ar');
      i18n.changeLanguage('ar');
      document.documentElement.dir = 'rtl';
      document.documentElement.lang = 'ar';
    } else {
      const dir = i18n.language === 'en' ? 'ltr' : 'rtl';
      document.documentElement.dir = dir;
      document.documentElement.lang = i18n.language;
    }

    const saved = localStorage.getItem('rememberedUser');
    if (saved) {
      setLoginId(saved);
      setRememberMe(true);
    }

    if (view === 'login') {
      localStorage.removeItem('is_registering');
      setGoogleUser(null);
    }
  }, []);

  // Sync view state dynamically when searchParams changes
  useEffect(() => {
    const mode = searchParams.get('view');
    if (mode === 'register') {
      setView('register');
    } else if (mode === 'forgot-password') {
      setView('forgot-password');
    } else if (searchParams.get('oauth') !== 'google') {
      setView('login');
    }
  }, [searchParams]);

  // Handles the return leg of the Google OAuth redirect flow (signInWithOAuth
  // navigates away to Google and back to /login?oauth=google once Supabase's
  // detectSessionInUrl has parsed the session). Mirrors what the old
  // signInWithPopup-based flow used to do synchronously right after the popup
  // resolved: detect whether this Google identity already has an account, and
  // if not, drop them into the register form pre-filled from their profile.
  useEffect(() => {
    const isOAuthReturn = searchParams.get('oauth') === 'google';
    if (!isOAuthReturn || !authUser) return;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const uid = authUser.id;
        const email = authUser.email || '';
        const displayName = authUser.user_metadata?.full_name || authUser.user_metadata?.name || '';

        // SECURITY: super_admin/SaaS-staff status is never granted here from
        // an email match — it's resolved below purely from existing
        // saas_users/staff/tenant rows, exactly like any other account.
        const { error: gUserError } = await supabase.from('users').upsert({
          id: uid,
          email,
          display_name: displayName || 'Owner',
          phone: authUser.phone || ''
        });

        if (gUserError && (gUserError.message?.includes('row-level security') || gUserError.code === '42501')) {
          throw new Error(t('login.errors.rls_permission_issue'));
        }

        const [tenantRes, requestRes, staffRes, saasRes] = await Promise.all([
          supabase.from('tenants').select('*').eq('owner_email', email).maybeSingle(),
          supabase.from('tailor_requests').select('*').eq('uid', uid).maybeSingle(),
          supabase.from('staff').select('*').or(`uid.eq.${uid},email.eq.${email}`).maybeSingle(),
          supabase.from('saas_users').select('role').eq('uid', uid).maybeSingle()
        ]);

        if (saasRes.data) {
          localStorage.removeItem('is_registering');
          (window as any).refreshAuthData?.();
          navigate('/admin/dashboard', { replace: true });
          return;
        }

        const hasAccount = tenantRes.data || requestRes.data || staffRes.data;

        if (hasAccount) {
          localStorage.removeItem('is_registering');
          (window as any).refreshAuthData?.();
          navigate('/', { replace: true });
          return;
        }

        // No account exists yet: transfer to Register view and pre-fill fields.
        // is_registering stays set until handleRegister finishes, so AuthContext
        // doesn't try to route this (accountless) session anywhere meanwhile.
        setGoogleUser(authUser);
        setView('register');
        setFullName(displayName);
        setRegEmail(email);
        setRegPhone(authUser.phone || '');
        navigate('/login?view=register', { replace: true });
      } catch (err: any) {
        localStorage.removeItem('is_registering');
        console.error('Google OAuth callback handling error:', err);
        setError(getAuthErrorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [searchParams, authUser, navigate, t]);

  // Phone Formatting Logic
  const validatePhone = (phone: string) => {
    return validateSaudiPhone(phone);
  };

  // Password Strength Logic
  const getPasswordStrength = (pass: string) => {
    if (!pass) return 0;
    let strength = 0;
    if (pass.length >= 8) strength += 1;
    if (/[A-Z]/.test(pass)) strength += 1;
    if (/[0-9]/.test(pass)) strength += 1;
    if (/[^A-Za-z0-9]/.test(pass)) strength += 1;
    return strength;
  };

  const strength = getPasswordStrength(regPassword);
  const strengthLabels = [
    t('login.strength.weak'),
    t('login.strength.medium'),
    t('login.strength.good'),
    t('login.strength.strong')
  ];
  const strengthColors = ['bg-danger', 'bg-warning', 'bg-brand', 'bg-success'];

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      // Set before navigating away: by the time the browser returns from
      // Google, this must already be in localStorage so AuthContext skips
      // resolving identity until the effect above decides where to route.
      // The timestamp lets AuthContext treat this as stale (and route
      // normally) if the round-trip gets interrupted and this never gets
      // cleared -- otherwise the whole app stays stuck on the loading
      // skeleton forever.
      localStorage.setItem('is_registering', 'true');
      localStorage.setItem('is_registering_at', String(Date.now()));
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/login?oauth=google` }
      });
      if (oauthError) {
        localStorage.removeItem('is_registering');
        throw oauthError;
      }
      // Browser is navigating to Google now; nothing else to do here.
    } catch (err: any) {
      localStorage.removeItem('is_registering');
      console.error('Google Login Error:', err);
      setError(getAuthErrorMessage(err));
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      console.log("[DEBUG] Starting Login for:", loginId);
      let emailToUse = loginId;
      if (!loginId.includes('@')) {
        const formattedPhone = formatSaudiPhone(loginId);
        console.log("[DEBUG] Phone login detected, formatting:", formattedPhone);

        try {
          // Check requests first
          const { data: reqSnap } = await supabase
            .from('tailor_requests')
            .select('email')
            .eq('phone', formattedPhone)
            .maybeSingle();

          if (reqSnap) {
            emailToUse = reqSnap.email;
          } else {
            // Check staff table
            const { data: staffSnap } = await supabase
              .from('staff')
              .select('email')
              .eq('phone', formattedPhone)
              .maybeSingle();

            if (staffSnap) {
              emailToUse = staffSnap.email;
            } else {
              throw new Error(t('login.errors.phone_not_registered'));
            }
          }
        } catch (fetchErr: any) {
             if (fetchErr instanceof TypeError && fetchErr.message === 'Failed to fetch') {
                 throw new Error(t('login.errors.db_unreachable', { url: import.meta.env.VITE_SUPABASE_URL || t('login.errors.no_url') }));
             }
             throw fetchErr;
        }
      }

      console.log("[DEBUG] Triggering signInWithPassword...");
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email: emailToUse, password });
      if (signInErr) throw signInErr;

      console.log("[DEBUG] Supabase Auth Success - Redirecting via App.tsx state change");

      if (rememberMe) {
        localStorage.setItem('rememberedUser', loginId);
      } else {
        localStorage.removeItem('rememberedUser');
      }
    } catch (err: any) {
      console.error('Login Error:', err);
      const isFetchError =
        (err instanceof TypeError && (err.message?.includes('fetch') || err.message?.includes('Network'))) ||
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('NetworkError');

      const isJwtError = err.message?.includes('suitable key') || err.message?.includes('PGRST301') || err.message?.includes('Expected 3 parts in JWT');

      if (isJwtError) {
        setError(t('login.errors.jwt_link_missing'));
      } else if (isFetchError) {
        setError(t('login.errors.db_unreachable_adblocker', { url: import.meta.env.VITE_SUPABASE_URL || t('login.errors.no_url') }));
      } else {
        setError(getAuthErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validatePhone(regPhone)) {
      setError(t('login.errors.invalid_phone'));
      return;
    }
    if (!googleUser && strength < 2) {
      setError(t('login.errors.weak_password'));
      return;
    }

    setLoading(true);
    setError(null);
    const formattedPhone = formatSaudiPhone(regPhone);

    try {
      // Check if phone or email already exists in Supabase
      let phoneSnap, emailSnap;
      try {
        const [ phoneRes, emailRes ] = await Promise.all([
          supabase.from('tailor_requests').select('id').eq('phone', formattedPhone),
          supabase.from('tailor_requests').select('id').eq('email', regEmail)
        ]);
        phoneSnap = phoneRes.data;
        emailSnap = emailRes.data;
      } catch (checkErr: any) {
        if (checkErr instanceof TypeError && checkErr.message === 'Failed to fetch') {
           throw new Error(t('login.errors.db_unreachable_network', { url: import.meta.env.VITE_SUPABASE_URL || t('login.errors.no_url') }));
        }
        throw checkErr;
      }

      if (phoneSnap && phoneSnap.length > 0) {
        setError(t('login.errors.phone_exists'));
        setLoading(false);
        return;
      }

      if (emailSnap && emailSnap.length > 0) {
        setError(t('login.errors.email_exists'));
        setLoading(false);
        return;
      }

      // Lock the auth listener in AuthContext from taking over prematurely.
      // Timestamped so AuthContext can treat it as stale and unblock itself
      // if this tab gets closed/interrupted mid-registration and the normal
      // cleanup below never runs.
      localStorage.setItem('is_registering', 'true');
      localStorage.setItem('is_registering_at', String(Date.now()));

      let user: { id: string };
      if (googleUser) {
        user = googleUser;
      } else {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: regEmail,
          password: regPassword,
          options: { data: { full_name: fullName, phone: formattedPhone } }
        });
        if (signUpError) {
          localStorage.removeItem('is_registering');
          throw signUpError;
        }
        if (!signUpData.session || !signUpData.user) {
          localStorage.removeItem('is_registering');
          throw new Error(t('login.errors.email_confirmation_required'));
        }
        user = signUpData.user;
      }

      // Create Onboarding Request in Supabase
      try {
        // Ensure plan records exist in database to prevent plan_id foreign key constraint failures
        try {
          const { data: plansData } = await supabase.from('plans').select('id');
          if (!plansData || plansData.length === 0 || !plansData.find(p => p.id === 'free')) {
            await supabase.from('plans').insert([
              { id: 'free', name: 'الباقة المجانية', price: 0, features: ['تجربة 14 يوم', 'عدد لا محدود من الفواتير', 'بدون ربط بطاقة'], max_staff: 2, max_orders: 100 },
              { id: 'basic', name: 'الخطة الأساسية', price: 599, features: ['إدارة العملاء', 'إدارة الطلبات', 'دعم فني'], max_staff: 5, max_orders: 50000 }
            ]);
          }
        } catch (planError) {
          console.error("Failed to ensure default plans are seeded:", planError);
        }

        // First insert the user into the global users table
        const { error: userInsertError } = await supabase
          .from('users')
          .insert({
            id: user.id,
            email: regEmail,
            display_name: fullName
          });

        if (userInsertError) {
          if (userInsertError.code === '23505' || userInsertError.message?.includes('users_email_key')) {
            throw new Error(t('login.errors.email_exists'));
          }
          throw userInsertError;
        }

        // Atomically create Tenant, Branch, and Initial Staff
        // Step 1: Create Tenant
        const { data: tenantData, error: tenantError } = await supabase
          .from('tenants')
          .insert({
            name: fullName + ' Store',
            owner_email: regEmail,
            owner_uid: user.id,
            phone: formattedPhone,
            status: 'active',
            plan_id: 'free',
            inventory_strategy: 'centralized'
          })
          .select('id')
          .single();

        if (tenantError) throw tenantError;
        const tenantId = tenantData.id;

        // Step 2: Create initial Branch
        const { data: branchData, error: branchError } = await supabase
          .from('branches')
          .insert({
            tenant_id: tenantId,
            name: t('common.branches.main_branch'),
            location: t('login.main_area'),
            phone: formattedPhone,
            type: 'store',
            is_main: true
          })
          .select('id')
          .single();

        if (branchError) throw branchError;
        const branchId = branchData.id;

        // Step 3: Create initial Staff (Owner Placeholder)
        const { error: staffError } = await supabase
          .from('staff')
          .insert({
            tenant_id: tenantId,
            uid: user.id,
            name: fullName,
            email: regEmail,
            phone: formattedPhone,
            role: 'owner',
            status: 'active',
            branch_id: branchId,
            must_change_pin: true
          });

        if (staffError) throw staffError;

        const { error: requestInsertError } = await supabase
          .from('tailor_requests')
          .insert({
            name: fullName,
            phone: formattedPhone,
            email: regEmail,
            uid: user.id,
            tenant_id: tenantId,
            status: 'approved',
            created_at: new Date().toISOString(),
            onboarding_step: 1
          });

        if (requestInsertError) throw requestInsertError;

      } catch (err: any) {
        console.error('Registration/Tenant Creation Error:', err);
        localStorage.removeItem('is_registering');
        // NOTE: unlike the old Firebase flow, there is no client-side "delete
        // this auth user" call available here (that requires the service-role
        // key, server-side only). A partial failure here leaves an orphaned,
        // tenant-less Supabase Auth user — harmless (it just falls into the
        // "no staff/tenant/request found -> onboarding step 1" resolution
        // branch on next login) and can be swept up later by an admin task.
        if (err instanceof TypeError && err.message === 'Failed to fetch') {
           throw new Error(t('login.errors.db_unreachable_short', { url: import.meta.env.VITE_SUPABASE_URL || '' }));
        }
        throw err;
      }

      // Successfully finished all operations! Clear registration lock and refresh state
      localStorage.removeItem('is_registering');
      if (typeof window !== 'undefined') {
        (window as any).refreshAuthData?.();
      }
    } catch (err: any) {
      localStorage.removeItem('is_registering');
      console.error('Registration Error:', err);
      if (err.code === '23505' || err.message?.includes('users_email_key')) {
        setError(t('login.errors.email_exists'));
      } else {
        const isFetchError =
          (err instanceof TypeError && (err.message.includes('fetch') || err.message.includes('Network'))) ||
          err.message?.includes('Failed to fetch') ||
          err.message?.includes('NetworkError');

        const isJwtError = err.message?.includes('suitable key') || err.message?.includes('PGRST301') || err.message?.includes('Expected 3 parts in JWT');
        if (isJwtError) {
          setError(t('login.errors.jwt_link_missing'));
        } else if (isFetchError) {
          setError(t('login.errors.db_unreachable_adblocker', { url: import.meta.env.VITE_SUPABASE_URL || t('login.errors.no_url') }));
        } else {
          setError(getAuthErrorMessage(err));
        }
      }
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
            <Scissors size={80} className="text-white" />
          </motion.div>
          <h1 className="text-5xl font-black mb-6 leading-tight">{t('login.title')}</h1>
          <p className="text-xl text-white/80 font-medium leading-relaxed">
            {t('login.subtitle')}
          </p>
        </div>
      </div>

      {/* Right Side - Forms */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 md:p-12">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full max-w-md space-y-8"
        >
          <div className="text-center lg:text-right">
            <div className="lg:hidden inline-block p-4 bg-brand/10 rounded-2xl text-brand mb-6">
              <Scissors size={32} />
            </div>
            <h2 className="text-3xl font-black text-content">
              {view === 'login' ? t('login.welcome_back') :
               view === 'register' ? t('login.create_account') :
               view === 'reset-sent' ? t('login.reset_link_sent_title') :
               t('login.forgot_password')}
            </h2>
            <p className="text-content-muted mt-2 font-medium">
              {view === 'login' ? t('login.login_desc') :
               view === 'register' ? t('login.register_desc') :
               view === 'reset-sent' ? t('login.reset_link_sent') :
               t('login.forgot_desc')}
            </p>
          </div>

          {searchParams.get('conflict') === 'true' && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-amber-500/10 border border-amber-500/20 text-amber-700 p-4 rounded-2xl flex items-start gap-3 text-sm font-bold"
            >
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{t('login.session_conflict_logout')}</span>
            </motion.div>
          )}

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

          <AnimatePresence mode="wait">
            {view === 'login' && (
              <motion.form
                key="login"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                onSubmit={handleEmailLogin}
                className="space-y-5"
              >
                <IconInput
                  required
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder={t('login.email_or_phone_placeholder')}
                  startIcon={Mail}
                  label={t('login.email_or_phone')}
                  wrapperClassName="h-11"
                />

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-xs font-black uppercase tracking-widest text-content-muted hover:text-content select-none">{t('login.password')}</label>
                    <button
                      type="button"
                      onClick={() => setView('forgot-password')}
                      className="text-xs font-bold text-brand hover:underline"
                    >
                      {t('login.forgot_password_link')}
                    </button>
                  </div>
                  <IconInput
                    required
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    startIcon={Lock}
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
                </div>

                <div className="flex items-center gap-2 px-1">
                  <input
                    type="checkbox"
                    id="remember"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-5 h-5 rounded-lg border-2 border-border text-brand focus:ring-brand"
                  />
                  <label htmlFor="remember" className="text-sm font-bold text-content-muted cursor-pointer">{t('login.remember_me')}</label>
                </div>

                <button
                  disabled={loading}
                  type="submit"
                  className="w-full bg-brand text-white py-4 rounded-2xl font-bold text-lg hover:bg-brand/90 transition-all shadow-xl shadow-brand/10 flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {loading ? <Loader2 className="animate-spin" /> : null}
                  <span>{t('login.login_button')}</span>
                </button>

                <div className="relative py-4">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border"></div></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-surface-muted px-2 text-content-muted font-bold">{t('login.or_with')}</span></div>
                </div>

                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  className="w-full bg-surface border-2 border-border py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-surface-muted transition-all text-content"
                >
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6" />
                  <span>{t('login.google')}</span>
                </button>

                <p className="text-center text-content-muted font-medium">
                  {t('login.no_account')}{' '}
                  <button type="button" onClick={() => setView('register')} className="text-brand font-bold hover:underline">{t('login.create_account')}</button>
                </p>

                <div className="pt-4 flex flex-col items-center gap-3">
                  <Branding className="opacity-50 mt-1" />
                </div>
              </motion.form>
            )}

            {view === 'register' && (
              <motion.form
                key="register"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                onSubmit={handleRegister}
                className="space-y-4"
              >
                <IconInput
                  required
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t('login.full_name')}
                  startIcon={User}
                  label={t('login.tailor_name')}
                  wrapperClassName="h-11"
                />

                <IconInput
                  required
                  type="tel"
                  value={regPhone}
                  onChange={(e) => setRegPhone(formatSaudiPhone(e.target.value))}
                  onBlur={() => setRegPhone(formatSaudiPhone(regPhone))}
                  placeholder="05xxxxxxxx"
                  startIcon={Phone}
                  label={t('login.phone')}
                  wrapperClassName="h-11"
                />

                <div className="relative">
                  <IconInput
                    required
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="example@mail.com"
                    startIcon={Mail}
                    label={t('login.email')}
                    wrapperClassName="h-11"
                    readOnly={!!googleUser}
                    disabled={!!googleUser}
                    className={cn(googleUser && "bg-gray-50 text-gray-400 cursor-not-allowed")}
                  />
                  {googleUser && (
                    <span className="absolute top-1 left-2 text-[10px] font-bold text-success bg-success/10 px-2 py-0.5 rounded-full">
                      {t('login.google_verified')}
                    </span>
                  )}
                </div>

                {!googleUser && (
                  <>
                    <IconInput
                      required
                      type={showPassword ? 'text' : 'password'}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="••••••••"
                      startIcon={Lock}
                      label={t('login.password')}
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
                    <div className="px-1 pt-2">
                      <div className="flex justify-between text-[10px] font-bold mb-1">
                        <span className="text-content-muted uppercase">{t('login.password_strength')}</span>
                        <span className={cn("uppercase", strength > 0 ? "text-brand" : "text-content-muted")}>
                          {regPassword ? strengthLabels[strength - 1] : ''}
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
                  </>
                )}

                <button
                  disabled={loading}
                  type="submit"
                  className="w-full bg-brand text-white py-4 rounded-2xl font-bold text-lg hover:bg-brand/90 transition-all shadow-xl shadow-brand/10 flex items-center justify-center gap-2 disabled:opacity-70 mt-4"
                >
                  {loading ? <Loader2 className="animate-spin" /> : <Send size={20} />}
                  <span>{t('login.register_button')}</span>
                </button>

                <p className="text-center text-content-muted font-medium">
                  {t('login.have_account')}{' '}
                  <button
                    type="button"
                    onClick={async () => {
                      localStorage.removeItem('is_registering');
                      setGoogleUser(null);
                      try {
                        await supabase.auth.signOut();
                      } catch (e) {
                        console.error(e);
                      }
                      setView('login');
                    }}
                    className="text-brand font-bold hover:underline"
                  >
                    {t('login.login_button')}
                  </button>
                </p>
              </motion.form>
            )}

            {view === 'forgot-password' && (
              <motion.form
                key="forgot"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  setLoading(true);
                  try {
                    const { error: resetError } = await supabase.auth.resetPasswordForEmail(loginId, {
                      redirectTo: `${window.location.origin}/reset-password`
                    });
                    if (resetError) throw resetError;
                    setView('reset-sent');
                  } catch (err) {
                    setError(t('login.errors.reset_failed'));
                  } finally {
                    setLoading(false);
                  }
                }}
                className="space-y-6"
              >
                <IconInput
                  required
                  type="email"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="example@mail.com"
                  startIcon={Mail}
                  label={t('login.email')}
                  wrapperClassName="h-11"
                />

                <button
                  disabled={loading}
                  type="submit"
                  className="w-full bg-brand text-white py-4 rounded-2xl font-bold text-lg hover:bg-brand/90 transition-all shadow-xl shadow-brand/10 flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {loading ? <Loader2 className="animate-spin" /> : null}
                  <span>{t('login.send_reset_link')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setView('login')}
                  className="w-full text-content-muted font-bold hover:text-brand transition-colors"
                >
                  {t('login.cancel_and_back')}
                </button>
              </motion.form>
            )}

            {view === 'reset-sent' && (
              <motion.div
                key="reset-sent"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-6 py-4"
              >
                <div className="inline-flex items-center justify-center w-20 h-20 bg-success/10 text-success rounded-full">
                  <CheckCircle size={40} />
                </div>
                <button
                  type="button"
                  onClick={() => setView('login')}
                  className="w-full bg-brand text-white py-4 rounded-2xl font-bold text-lg hover:bg-brand/90 transition-all shadow-xl shadow-brand/10 flex items-center justify-center gap-2"
                >
                  {t('login.login_button')}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
