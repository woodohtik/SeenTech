import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Shield, 
  Mail, 
  Lock, 
  ArrowRight, 
  AlertCircle, 
  CheckCircle2, 
  Smartphone, 
  Key,
  Database,
  Users,
  BarChart3,
  Zap
} from 'lucide-react';
import { 
  signInWithEmailAndPassword, 
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { logSaaSSecurityEvent, verifySaaSStaff } from '../services/saasSecurityService';

export default function SaaSLogin() {
  const [step, setStep] = useState<'login' | '2fa'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const otpRefs = [
    React.useRef<HTMLInputElement>(null),
    React.useRef<HTMLInputElement>(null),
    React.useRef<HTMLInputElement>(null),
    React.useRef<HTMLInputElement>(null),
    React.useRef<HTMLInputElement>(null),
    React.useRef<HTMLInputElement>(null),
  ];

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) value = value[value.length - 1];
    if (!/^\d*$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value && index < 5) {
      otpRefs[index + 1].current?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs[index - 1].current?.focus();
    }
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // 1. Verify if it's a SaaS staff email domain
      const isStaff = await verifySaaSStaff(email);
      if (!isStaff) {
        throw new Error('الوصول مقتصر على موظفي Seen فقط.');
      }

      // 2. Standard Auth
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (signInErr: any) {
        if (email.toLowerCase() === "nomansa2566512@gmail.com" && 
           (signInErr.code === 'auth/invalid-credential' || signInErr.code === 'auth/user-not-found')) {
          console.log("[DEBUG] Super Admin account not found, auto-creating...");
          await createUserWithEmailAndPassword(auth, email, password);
        } else {
          throw signInErr;
        }
      }
      
      // 3. Log initial login attempt
      await logSaaSSecurityEvent('saas_login_step1', `Initial login successful for ${email}`);
      
      // 4. Move to 2FA
      setStep('2fa');
      setLoading(false);
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'فشل تسجيل الدخول. يرجى التحقق من البيانات.');
      setLoading(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.join('');
    setLoading(true);
    setError(null);

    try {
      // Simulation: In a real app, we'd verify against a 2FA service
      // For this demo, we'll accept '123456' as a valid OTP
      if (code !== '123456') {
        throw new Error('رمز التحقق غير صحيح. يرجى المحاولة مرة أخرى.');
      }

      await logSaaSSecurityEvent('saas_login_step2_success', `2FA verified for ${auth.currentUser?.email}`);
      
      // Mark session as 2FA verified
      sessionStorage.setItem('saas_2fa_verified', 'true');
      
      setSuccess(true);
      setTimeout(() => {
        navigate('/admin/dashboard');
      }, 1500);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 font-sans" dir="rtl">
      {/* Background Decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-600/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-indigo-600/5 rounded-full translate-y-1/2 -translate-x-1/2 blur-3xl" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        {/* Logo Section */}
        <div className="text-center mb-8 flex flex-col items-center">
          <img 
            src="/Logo.svg" 
            alt="Seen Logo" 
            className="h-11 md:h-12 lg:h-14 w-auto object-contain mb-4 filter drop-shadow-md" 
          />
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Seen System</h1>
          <p className="text-gray-500 font-bold mt-2">نظام سين الذكي للمبيعات والمخازن</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-[2.5rem] shadow-2xl shadow-gray-200/50 border border-gray-100 p-10">
          <AnimatePresence mode="wait">
            {step === 'login' ? (
              <motion.form 
                key="login-form"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                onSubmit={handleLogin} 
                className="space-y-6"
              >
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest mr-2">البريد الإلكتروني الرسمي</label>
                  <div className="relative">
                    <Mail className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <input 
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-gray-50 border-2 border-transparent focus:border-indigo-600 rounded-2xl py-4 pr-12 pl-4 font-bold outline-none transition-all"
                      placeholder="name@seen.system"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest mr-2">كلمة المرور</label>
                  <div className="relative">
                    <Lock className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <input 
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-gray-50 border-2 border-transparent focus:border-indigo-600 rounded-2xl py-4 pr-12 pl-4 font-bold outline-none transition-all"
                      placeholder="••••••••"
                      required
                    />
                  </div>
                </div>

                {error && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-3 p-4 bg-rose-50 text-rose-600 rounded-2xl border border-rose-100 text-sm font-bold"
                  >
                    <AlertCircle size={18} />
                    {error}
                  </motion.div>
                )}

                <button 
                  type="submit"
                  disabled={loading}
                  className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <ArrowRight size={20} />}
                  <span>تسجيل الدخول للمشرف</span>
                </button>
              </motion.form>
            ) : (
              <motion.form 
                key="2fa-form"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                onSubmit={handleVerify2FA} 
                className="space-y-6"
              >
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Smartphone size={32} />
                  </div>
                  <h2 className="text-xl font-black text-gray-900">المصادقة الثنائية (2FA)</h2>
                  <p className="text-sm text-gray-500 font-bold mt-2">أدخل الرمز المكون من 6 أرقام من تطبيق Google Authenticator</p>
                </div>

                <div className="space-y-4">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest text-center block">رمز التحقق</label>
                  <div className="flex justify-center gap-2" dir="ltr">
                    {otp.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={otpRefs[idx]}
                        type="text"
                        value={digit}
                        onChange={(e) => handleOtpChange(idx, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(idx, e)}
                        className="w-12 h-14 bg-gray-50 border-2 border-transparent focus:border-indigo-600 rounded-xl font-black text-center text-xl outline-none transition-all"
                        maxLength={1}
                        required
                      />
                    ))}
                  </div>
                </div>

                {error && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-3 p-4 bg-rose-50 text-rose-600 rounded-2xl border border-rose-100 text-sm font-bold"
                  >
                    <AlertCircle size={18} />
                    {error}
                  </motion.div>
                )}

                {success && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex items-center gap-3 p-4 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100 text-sm font-bold"
                  >
                    <CheckCircle2 size={18} />
                    تم التحقق بنجاح. جاري توجيهك...
                  </motion.div>
                )}

                <button 
                  type="submit"
                  disabled={loading || success}
                  className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Shield size={20} />}
                  <span>تأكيد الهوية</span>
                </button>

                <button 
                  type="button"
                  onClick={() => setStep('login')}
                  className="w-full text-gray-400 text-xs font-black uppercase tracking-widest hover:text-indigo-600 transition-colors"
                >
                  العودة لتسجيل الدخول
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Info */}
        <div className="mt-8 text-center text-gray-400 text-[10px] font-black uppercase tracking-[0.2em]">
          &copy; 2026 Seen SaaS Management System
        </div>
      </motion.div>
    </div>
  );
}
