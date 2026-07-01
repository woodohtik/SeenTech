import React, { useState, useEffect } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { supabase, setSupabaseAuthToken } from '../lib/supabase/client';
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
  Terminal
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Branding from './Branding';
import { IconInput } from './ui/IconInput';

type ViewMode = 'login' | 'register' | 'pending' | 'forgot-password';

export default function Login() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>('login');
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

  const languages = [
    { code: 'ar', name: 'العربية', dir: 'rtl' },
    { code: 'en', name: 'English', dir: 'ltr' },
    { code: 'ur', name: 'اردو', dir: 'rtl' }
  ];

  const currentLanguage = languages.find(l => l.code === i18n.language) || languages[0];

  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code);
    setIsLangMenuOpen(false);
  };

  // Load remembered loginId
  useEffect(() => {
    const saved = localStorage.getItem('rememberedUser');
    if (saved) {
      setLoginId(saved);
      setRememberMe(true);
    }

    // Auto-redirect if already logged in (backup to App.tsx)
    if (auth) {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user && user.email?.toLowerCase() === "nomansa2566512@gmail.com") {
           console.log("[DEBUG] Login component detected Super Admin session - auto-redirecting to /");
           // App.tsx handles the actual state, but we can nudge it
        }
      });
      return () => unsubscribe();
    }
  }, []);

  // Phone Formatting Logic
  const formatSaudiPhone = (phone: string) => {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('05') && cleaned.length === 10) {
      return '+966' + cleaned.substring(1);
    } else if (cleaned.startsWith('5') && cleaned.length === 9) {
      return '+966' + cleaned;
    }
    return phone;
  };

  const validatePhone = (phone: string) => {
    const formatted = formatSaudiPhone(phone);
    return formatted.startsWith('+9665') && formatted.length === 13;
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
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Check Super Admin
      if (user.email === "nomansa2566512@gmail.com") {
        setLoading(false);
        return;
      }
      
      // Ensure user exists in users table upon google sign-in
      const { error: gUserError } = await supabase.from('users').upsert({
        id: user.uid,
        email: user.email,
        display_name: user.displayName || 'Owner',
        phone: user.phoneNumber || ''
      });
      
      if (gUserError) {
         if (gUserError.message?.includes('row-level security') || gUserError.code === '42501') {
            throw new Error(`مشكلة في صلاحيات قاعدة البيانات (RLS). يرجى تنفيذ ملف allow-all-rls.sql في واجهة Supabase لتتمكن من التسجيل.`);
         }
      }

      // Check existing tenant or request using Supabase
      const { data: tenantSnap } = await supabase
        .from('tenants')
        .select('*')
        .eq('owner_email', user.email);
      
      if (tenantSnap && tenantSnap.length > 0) {
        const tenant = tenantSnap[0];
        // if (tenant.status === 'pending') setView('pending'); // Handled by App.tsx
        return;
      }

      const { data: reqSnap } = await supabase
        .from('tailor_requests')
        .select('*')
        .eq('uid', user.uid);
      
      if (!reqSnap || reqSnap.length === 0) {
        setView('register');
        setFullName(user.displayName || '');
        setRegEmail(user.email || '');
      } else {
        const request = reqSnap[0];
        // if (request.status === 'pending') setView('pending'); // Handled by App.tsx
      }
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        console.log('Google login popup was closed by the user.');
        // No need to set error for intentional user cancellation
      } else {
        console.error('Google Login Error:', err);
        if (err.code === 'auth/popup-blocked') {
          setError(t('login.errors.popup_blocked', 'تم حظر النوافذ المنبثقة، يرجى السماح بها'));
        } else if (err.code === 'permission-denied') {
          setError(t('login.errors.permission_denied', 'تم رفض الصلاحية'));
        } else if (err.code === 'auth/network-request-failed') {
          setError('فشل الاتصال بخوادم المصادقة. يرجى التأكد من اتصال الإنترنت وإيقاف إضافات حجب الإعلانات (Ad blockers). إذا كنت تستخدم المعاينة، جرب فتح التطبيق في نافذة جديدة.');
        } else {
          setError(t('common.error', 'خطأ') + ': ' + (err.message || 'Unknown error'));
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      console.log("[DEBUG] Starting Login for:", loginId);
      // 0. Super Admin Auto-Resolution
      let emailToUse = loginId;
      if (loginId.toLowerCase() === "nomansa2566512@gmail.com") {
        emailToUse = loginId;
        console.log("[DEBUG] Super Admin Login Path - using email directly");
      } else if (!loginId.includes('@')) {
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
              // Check if it's the super admin phone (optional but good for recovery)
              if (loginId.includes('2566512')) { // Part of the email handle
                 emailToUse = "nomansa2566512@gmail.com";
              } else {
                 throw new Error(t('login.errors.phone_not_registered'));
              }
            }
          }
        } catch (fetchErr: any) {
             if (fetchErr instanceof TypeError && fetchErr.message === 'Failed to fetch') {
                 throw new Error(`تعذر الاتصال بقاعدة البيانات. تأكد من أن الروابط تعمل وأنه لا يوجد أداة تحجب الاتصال. ${import.meta.env.VITE_SUPABASE_URL || 'لا يوجد رابط'}`);
             }
             throw fetchErr;
        }
      }

      console.log("[DEBUG] Triggering signInWithEmailAndPassword...");
      let isSuperAdminFallback = false;
      if (!auth) {
        throw new Error("لم يتم إعداد خدمات مقبس الحسابات (Firebase). الرجاء إضافتها من قائمة Secrets.");
      }
      try {
        await signInWithEmailAndPassword(auth, emailToUse, password);
      } catch (signInErr: any) {
        if (emailToUse.toLowerCase() === "nomansa2566512@gmail.com" && 
           (signInErr.code === 'auth/invalid-credential' || signInErr.code === 'auth/user-not-found')) {
          console.log("[DEBUG] Super Admin account not found, auto-creating...");
          await createUserWithEmailAndPassword(auth, emailToUse, password);
          isSuperAdminFallback = true;
        } else {
          throw signInErr;
        }
      }
      console.log("[DEBUG] Firebase Auth Success - Redirecting via App.tsx state change");
      
      if (rememberMe) {
        localStorage.setItem('rememberedUser', loginId);
      } else {
        localStorage.removeItem('rememberedUser');
      }
    } catch (err: any) {
      console.error('Login Error:', err);
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError(t('login.errors.invalid_credentials'));
      } else if (err.code === 'auth/network-request-failed') {
        setError('فشل الاتصال بخوادم المصادقة. يرجى التأكد من اتصال الإنترنت وإيقاف إضافات حجب الإعلانات (Ad blockers). إذا كنت تستخدم المعاينة، جرب فتح التطبيق في نافذة جديدة.');
      } else {
        console.error("Unknown error caught during login:", err);
        const isFetchError = 
          (err instanceof TypeError && (err.message.includes('fetch') || err.message.includes('Network'))) ||
          err.message?.includes('Failed to fetch') ||
          err.message?.includes('NetworkError');

        const isJwtError = err.message?.includes('suitable key') || err.message?.includes('PGRST301') || err.message?.includes('Expected 3 parts in JWT');
        if (isJwtError) {
          setError("خطأ في الاتصال: لم يتم تفعيل ربط Supabase بـ Firebase. راجع الإعدادات (Custom JWT).");
        } else if (isFetchError) {
          setError(`تعذر الاتصال بقاعدة البيانات. تأكد من أن الروابط تعمل وأنه لا يوجد أداة تحجب الاتصال (Adblocker). ${import.meta.env.VITE_SUPABASE_URL || 'لا يوجد رابط'}`);
        } else {
          setError(err.message || t('login.errors.invalid_credentials'));
        }
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
    if (strength < 2) {
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
           throw new Error(`تعذر الاتصال بقاعدة البيانات. المشكلة قد تكون من إعدادات الشبكة (حاجب الإعلانات) أو روابط Supabase. ${import.meta.env.VITE_SUPABASE_URL || 'لا يوجد رابط'}`);
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

      if (!auth) {
        throw new Error("لم يتم إعداد خدمات مقبس الحسابات (Firebase). الرجاء إضافة متغيرات VITE_FIREBASE_API_KEY من قائمة Secrets.");
      }
      
      // Lock the Firebase observer in App.tsx from taking over prematurely 
      localStorage.setItem('is_registering', 'true');

      let userCredential;
      try {
        userCredential = await createUserWithEmailAndPassword(auth, regEmail, regPassword);
      } catch (authErr: any) {
        localStorage.removeItem('is_registering');
        throw authErr;
      }

      const user = userCredential.user;
      
      const token = await user.getIdToken();
      setSupabaseAuthToken(token);

      // Create Onboarding Request in Supabase
      try {
        // Ensure plan records exist in database to prevent plan_id foreign key constraint failures
        try {
          const { data: plansData } = await supabase.from('plans').select('id');
          if (!plansData || plansData.length === 0) {
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
            id: user.uid,
            email: regEmail,
            display_name: fullName
          });

        if (userInsertError) {
          if (userInsertError.code === '23505' || userInsertError.message?.includes('users_email_key')) {
            const friendlyErr = new Error(t('login.errors.email_exists') || 'البريد الإلكتروني مسجل بالفعل');
            (friendlyErr as any).code = 'auth/email-already-in-use';
            throw friendlyErr;
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
            owner_uid: user.uid,
            phone: formattedPhone,
            status: 'active',
            plan_id: 'basic',
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
            name: 'المعرض الرئيسي',
            location: 'المنطقة الرئيسية',
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
            uid: user.uid,
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
            uid: user.uid,
            tenant_id: tenantId,
            status: 'approved',
            created_at: new Date().toISOString(),
            onboarding_step: 1
          });
        
        if (requestInsertError) throw requestInsertError;

      } catch (err: any) {
        console.error('Registration/Tenant Creation Error:', err);
        localStorage.removeItem('is_registering');
        // If request creation fails, we should rollback the Firebase user unit
        try {
          await user.delete();
        } catch (delErr) {
          console.error("Failed to delete user during registration failure rollback:", delErr);
        }
        if (err instanceof TypeError && err.message === 'Failed to fetch') {
           throw new Error(`تعذر الاتصال بقاعدة البيانات. ${import.meta.env.VITE_SUPABASE_URL || ''}`);
        }
        throw err;
      }

      // Successfully finished all operations! Clear registration lock and refresh state
      localStorage.removeItem('is_registering');
      if (typeof window !== 'undefined') {
        (window as any).refreshAuthData?.();
      }

      // setView('pending'); // removed so that App.tsx can redirect cleanly to Onboarding
    } catch (err: any) {
      localStorage.removeItem('is_registering');
      console.error('Registration Error:', err);
      if (err.code === 'auth/email-already-in-use' || err.code === '23505' || err.message?.includes('users_email_key')) {
        setError(t('login.errors.email_exists') || 'البريد الإلكتروني مسجل بالفعل في النظام');
      } else if (err.code === 'auth/invalid-email') {
        setError(t('login.errors.invalid_email', 'البريد الإلكتروني غير صالح'));
      } else if (err.code === 'auth/weak-password') {
        setError(t('login.errors.weak_password'));
      } else if (err.code === 'auth/operation-not-allowed') {
        setError(t('login.errors.operation_not_allowed', 'يجب تفعيل خيار "البريد الإلكتروني وكلمة المرور" في إعدادات Firebase Console'));
      } else if (err.code === 'permission-denied') {
        setError(t('login.errors.permission_denied'));
      } else if (err.code === 'auth/network-request-failed') {
        setError('فشل الاتصال بخوادم المصادقة. يرجى التأكد من اتصال الإنترنت وإيقاف إضافات حجب الإعلانات (Ad blockers). إذا كنت تستخدم المعاينة، جرب فتح التطبيق في نافذة جديدة.');
      } else {
        console.error("Unknown error caught:", err);
        const isFetchError = 
          (err instanceof TypeError && (err.message.includes('fetch') || err.message.includes('Network'))) ||
          err.message?.includes('Failed to fetch') ||
          err.message?.includes('NetworkError');

        const isJwtError = err.message?.includes('suitable key') || err.message?.includes('PGRST301') || err.message?.includes('Expected 3 parts in JWT');
        if (isJwtError) {
          setError("خطأ في الاتصال: لم يتم تفعيل ربط Supabase بـ Firebase. راجع الإعدادات (Custom JWT).");
        } else if (isFetchError) {
          setError(`تعذر الاتصال بقاعدة البيانات. تأكد من أن الروابط تعمل وأنه لا يوجد أداة تحجب الاتصال (Adblocker). ${import.meta.env.VITE_SUPABASE_URL || 'لا يوجد رابط'}`);
        } else {
          setError(`${t('login.errors.unknown', 'حدث خطأ غير معروف')}: ${err.message || 'No additional info'}`);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-surface-muted font-sans">
      {/* Language Switcher */}
      <div className="absolute top-4 right-4 z-50">
        <div className="relative">
          <button 
            onClick={() => setIsLangMenuOpen(!isLangMenuOpen)}
            className="flex items-center gap-2 bg-surface px-4 py-2 rounded-xl shadow-sm border border-border hover:bg-surface-muted transition-colors"
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
               view === 'forgot-password' ? t('login.forgot_password') : t('login.pending_review')}
            </h2>
            <p className="text-content-muted mt-2 font-medium">
              {view === 'login' ? t('login.login_desc') : 
               view === 'register' ? t('login.register_desc') : 
               view === 'forgot-password' ? t('login.forgot_desc') : t('login.pending_desc')}
            </p>
          </div>

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
                  placeholder={i18n.language === 'en' ? "example@mail.com or 05xxxxxxxx" : "example@mail.com أو 05xxxxxxxx"}
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

                <div className="pt-4 flex flex-col items-center gap-4">
                  <button 
                    type="button" 
                    onClick={() => {
                      sessionStorage.setItem('dev_bypass', 'true');
                      navigate('/admin/tailors');
                    }}
                    className="flex items-center gap-2 px-6 py-3 bg-warning/10 text-warning-muted rounded-2xl text-xs font-black hover:bg-warning/20 transition-all border border-warning/20"
                  >
                    <Terminal size={14} />
                    <span>{t('login.dev_bypass', 'تخطي للتطوير (إدارة المشتركين)')}</span>
                  </button>
                  <Branding className="opacity-50" />
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
                  onChange={(e) => setRegPhone(e.target.value)}
                  onBlur={() => setRegPhone(formatSaudiPhone(regPhone))}
                  placeholder="05xxxxxxxx"
                  startIcon={Phone}
                  label={t('login.phone')}
                  wrapperClassName="h-11"
                />

                <IconInput
                  required
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="example@mail.com"
                  startIcon={Mail}
                  label={t('login.email')}
                  wrapperClassName="h-11"
                />

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
                  <button type="button" onClick={() => setView('login')} className="text-brand font-bold hover:underline">{t('login.login_button')}</button>
                </p>
              </motion.form>
            )}

            {view === 'pending' && (
              <motion.div 
                key="pending"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-6 py-8"
              >
                <div className="inline-flex items-center justify-center w-24 h-24 bg-success/10 text-success rounded-full mb-4">
                  <CheckCircle size={48} />
                </div>
                <h2 className="text-2xl font-black text-content">{t('login.pending_success_title')}</h2>
                <p className="text-content-muted font-medium leading-relaxed">
                  {t('login.pending_success_desc')}
                </p>
                <button 
                  onClick={() => {
                    signOut(auth);
                    setView('login');
                  }}
                  className="flex items-center justify-center gap-2 text-brand font-bold hover:underline mx-auto"
                >
                  <ArrowRight size={18} className={cn(i18n.language === 'en' ? "rotate-180" : "")} />
                  <span>{t('login.back_to_login')}</span>
                </button>
              </motion.div>
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
                    await sendPasswordResetEmail(auth, loginId);
                    alert(t('login.reset_link_sent', 'تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني'));
                    setView('login');
                  } catch (err) {
                    setError(t('login.errors.reset_failed', 'فشل إرسال البريد، تأكد من صحة العنوان'));
                  } finally {
                    setLoading(false);
                  }
                }}
                className="space-y-6"
              >
                <div className="space-y-2">
                  <label className="text-sm font-bold text-content mx-1">{t('login.email')}</label>
                  <div className="relative group">
                    <Mail className={cn(
                      "absolute top-1/2 -translate-y-1/2 text-content-muted group-focus-within:text-brand transition-colors",
                      i18n.language === 'en' ? "left-4" : "right-4"
                    )} size={20} />
                    <input 
                      required
                      type="email"
                      value={loginId}
                      onChange={(e) => setLoginId(e.target.value)}
                      placeholder="example@mail.com"
                      className={cn(
                        "w-full bg-surface border-2 border-border rounded-2xl py-4 focus:border-brand focus:ring-0 outline-none transition-all font-medium text-content",
                        i18n.language === 'en' ? "pl-12 pr-4" : "pr-12 pl-4"
                      )}
                    />
                  </div>
                </div>

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
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
