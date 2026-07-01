import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, Delete, User, Users, Lock, AlertCircle, LogOut, CheckCircle2, Loader2 } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { supabase } from '../lib/supabase/client';
import { auth } from '../lib/firebase';
import { Staff } from '../types';
import { cn } from '../lib/utils';
import bcrypt from 'bcryptjs';
import { hashPin } from '../services/staffService';
import { logEmployeeAction } from '../services/employeeAuditService';
import Branding from './Branding';

interface PinLoginProps {
  tenantId: string;
  onLogin: (staff: Staff) => void;
}

export default function PinLogin({ tenantId, onLogin }: PinLoginProps) {
  const [pin, setPin] = useState('');
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [mustChangePin, setMustChangePin] = useState<Staff | null>(null);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isChanging, setIsChanging] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    const fetchStaff = async () => {
      const [{ data: staffData }, { data: rolesData }] = await Promise.all([
        supabase
          .from('staff')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('status', 'active'),
        supabase
          .from('roles')
          .select('*')
          .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      ]);
      
      if (staffData) {
        const rolesMap = new Map(rolesData?.map(r => [r.id, r.role_key]) || []);
        setStaffList(staffData.map(d => {
          const actualRole = d.role_id ? (rolesMap.get(d.role_id) || d.role) : d.role;
          return {
            ...d,
            role: actualRole,
            tenantId: d.tenant_id,
            branchId: d.branch_id,
            roleId: d.role_id,
            pin: d.pin_hash,
            mustChangePin: d.must_change_pin,
            isTest: d.is_test,
            createdAt: d.created_at,
            updatedAt: d.updated_at
          } as Staff;
        }));
      }
    };
    fetchStaff();
  }, [tenantId]);

  const handleNumberClick = (num: string) => {
    if (pin.length < 4) {
      setPin(prev => prev + num);
      setError(null);
      // Visual feedback
      setActiveKey(num);
      setTimeout(() => setActiveKey(null), 100);
    }
  };

  const handleDelete = () => {
    if (pin.length > 0) {
      setPin(prev => prev.slice(0, -1));
      setError(null);
      // Visual feedback
      setActiveKey('Backspace');
      setTimeout(() => setActiveKey(null), 100);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (/\d/.test(e.key)) {
        handleNumberClick(e.key);
      } else if (e.key === 'Backspace') {
        handleDelete();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pin]);

  useEffect(() => {
    if (pin.length === 4 && !isVerifying) {
      verifyPin();
    }
  }, [pin, isVerifying]);

  const verifyPin = async () => {
    if (isVerifying) return;
    setIsVerifying(true);
    setError(null);
    try {
      // Find possible matches
      const checkPromises = staffList.map(async s => {
        if (!s.pin) return null;
        try {
          const isMatch = await bcrypt.compare(pin, s.pin);
          return isMatch ? s : null;
        } catch (e) {
          return null;
        }
      });

      const checkResults = await Promise.all(checkPromises);
      const matchedStaff = checkResults.find(s => s !== null);
      
      if (matchedStaff) {
        if (matchedStaff.mustChangePin) {
          setMustChangePin(matchedStaff);
          setIsVerifying(false);
        } else {
          // Success Path - Immediate Action
          onLogin(matchedStaff);
          
          // Log in background
          logEmployeeAction(
            tenantId,
            matchedStaff.id,
            matchedStaff.name,
            'login',
            `تسجيل الدخول للنظام (PIN)`
          ).catch(() => {});
          
          // Note: we don't necessarily need setIsVerifying(false) here if unmounting
        }
      } else {
        setError('رمز الدخول غير صحيح');
        setPin('');
        setIsVerifying(false);
      }
    } catch (err) {
      console.error("[PinLogin] Error:", err);
      setError('حدث خطأ أثناء التحقق');
      setIsVerifying(false);
    }
  };

  const handlePinChange = async () => {
    if (!mustChangePin) return;
    if (newPin.length !== 4) {
      setError('يجب أن يكون الرمز الجديد 4 أرقام');
      return;
    }
    if (newPin !== confirmPin) {
      setError('الرمزان غير متطابقين');
      return;
    }

    setIsChanging(true);
    try {
      const hashedPin = await hashPin(newPin);
      const { error: updateError } = await supabase
        .from('staff')
        .update({
          pin_hash: hashedPin,
          must_change_pin: false
        })
        .eq('id', mustChangePin.id);

      if (updateError) throw updateError;
      
      // Trigger global refresh
      if ((window as any).refreshAuthData) {
        (window as any).refreshAuthData();
      }

      onLogin({ ...mustChangePin, pin: hashedPin, mustChangePin: false });
    } catch (err) {
      setError('فشل تحديث الرمز السري');
    } finally {
      setIsChanging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-surface flex items-center justify-center overflow-hidden font-sans" dir="rtl">
      <div className="flex w-full h-full">
        {/* Right Side: PIN Login Form */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-surface-muted/50">
          <AnimatePresence mode="wait">
            {mustChangePin ? (
              <motion.div 
                key="change-pin"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-md bg-surface rounded-[3rem] shadow-xl border border-border p-10 relative z-10 flex flex-col items-center"
              >
                <div className="w-20 h-20 bg-warning/10 rounded-3xl flex items-center justify-center text-warning mb-6 shadow-inner">
                  <Lock size={40} />
                </div>
                <h2 className="text-3xl font-black text-content mb-2 text-center">تغيير رمز الدخول</h2>
                <p className="text-content-muted text-sm mb-8 text-center font-medium">لأمان حسابك، يرجى تعيين رمز دخول جديد خاص بك</p>

                <div className="w-full space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-black text-content-muted uppercase tracking-widest mr-2">الرمز الجديد</label>
                    <input 
                      type="password"
                      maxLength={4}
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full bg-surface-muted border-2 border-transparent focus:border-brand rounded-2xl p-4 text-center text-2xl font-black tracking-[1em] outline-none transition-all text-content"
                      placeholder="****"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-content-muted uppercase tracking-widest mr-2">تأكيد الرمز</label>
                    <input 
                      type="password"
                      maxLength={4}
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                      className="w-full bg-surface-muted border-2 border-transparent focus:border-brand rounded-2xl p-4 text-center text-2xl font-black tracking-[1em] outline-none transition-all text-content"
                      placeholder="****"
                    />
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 text-danger text-xs font-bold bg-danger/10 px-4 py-2 rounded-xl border border-danger/20">
                      <AlertCircle size={14} />
                      <span>{error}</span>
                    </div>
                  )}

                  <button 
                    onClick={handlePinChange}
                    disabled={isChanging || newPin.length !== 4 || confirmPin.length !== 4}
                    className="w-full bg-brand text-white py-4 rounded-2xl font-black hover:bg-brand/90 shadow-xl shadow-brand/10 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isChanging ? 'جاري الحفظ...' : 'تأكيد الرمز الجديد'}
                  </button>
                  
                  <button 
                    onClick={() => {
                      setMustChangePin(null);
                      setPin('');
                      setNewPin('');
                      setConfirmPin('');
                      setError(null);
                    }}
                    className="w-full text-content-muted font-bold py-2 hover:text-content transition-colors"
                  >
                    إلغاء
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="login-pin"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="w-full max-w-md bg-surface rounded-[3rem] shadow-xl border border-border p-10 relative z-10 flex flex-col items-center"
              >
                <div className="lg:hidden w-20 h-20 bg-brand/5 rounded-3xl flex items-center justify-center text-brand mb-6 shadow-inner">
                  <Shield size={40} />
                </div>

                <h2 className="text-3xl font-black text-content mb-2 text-center">دخول الموظفين</h2>
                <p className="text-content-muted text-sm mb-10 text-center font-medium">الرجاء إدخال رمز الدخول السريع الخاص بك</p>

                {/* PIN Display */}
                <div className="flex gap-4 mb-10 relative">
                  {[0, 1, 2, 3].map((i) => (
                    <motion.div
                      key={i}
                      animate={pin.length === i ? { scale: [1, 1.1, 1] } : {}}
                      className={cn(
                        "w-14 h-20 rounded-2xl border-2 flex items-center justify-center transition-all duration-200 text-2xl font-black",
                        pin.length > i ? "bg-brand border-brand text-white" : "bg-surface-muted border-border",
                        error && "border-danger bg-danger/5 text-danger"
                      )}
                    >
                      {pin.length > i ? (
                        <div className="w-4 h-4 bg-current rounded-full" />
                      ) : (
                        pin.length === i && !isVerifying && <div className="w-1.5 h-8 bg-brand/20 rounded-full animate-pulse" />
                      )}
                    </motion.div>
                  ))}
                  
                  {isVerifying && (
                    <div className="absolute inset-0 flex items-center justify-center bg-surface/50 backdrop-blur-[1px] rounded-2xl">
                      <Loader2 size={32} className="text-brand animate-spin" />
                    </div>
                  )}
                </div>

                <AnimatePresence mode="wait">
                  {error && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="flex items-center gap-2 text-danger text-sm font-bold mb-8 bg-danger/10 px-6 py-3 rounded-2xl border border-danger/20"
                    >
                      <AlertCircle size={18} />
                      <span>{error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Numpad */}
                <div className="grid grid-cols-3 gap-5 w-full">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                    <button
                      key={num}
                      onClick={() => handleNumberClick(num.toString())}
                      disabled={isVerifying}
                      className={cn(
                        "h-20 rounded-2xl text-3xl font-black transition-all active:scale-95 disabled:opacity-50 border border-transparent",
                        activeKey === num.toString() 
                          ? "bg-brand text-white scale-95 shadow-lg shadow-brand/20 border-brand" 
                          : "bg-surface-muted text-content hover:bg-brand/5 hover:text-brand hover:border-brand/10"
                      )}
                    >
                      {num}
                    </button>
                  ))}
                  <div className="h-20" />
                  <button
                    onClick={() => handleNumberClick('0')}
                    disabled={isVerifying}
                    className={cn(
                      "h-20 rounded-2xl text-3xl font-black transition-all active:scale-95 disabled:opacity-50 border border-transparent",
                      activeKey === '0' 
                        ? "bg-brand text-white scale-95 shadow-lg shadow-brand/20 border-brand" 
                        : "bg-surface-muted text-content hover:bg-brand/5 hover:text-brand hover:border-brand/10"
                    )}
                  >
                    0
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={isVerifying}
                    className={cn(
                      "h-20 rounded-2xl flex items-center justify-center transition-all active:scale-95 disabled:opacity-50 border border-transparent",
                      activeKey === 'Backspace'
                        ? "bg-danger text-white scale-95 shadow-lg shadow-danger/20 border-danger"
                        : "bg-surface-muted text-content-muted hover:bg-danger/10 hover:text-danger hover:border-danger/20"
                    )}
                  >
                    <Delete size={28} />
                  </button>
                </div>

                <div className="mt-10 pt-8 border-t border-border w-full">
                  <button 
                    onClick={async () => {
                      if (auth) {
                        try {
                          await signOut(auth);
                        } catch (err) {
                          console.error("Error signing out from PIN screen:", err);
                        }
                      }
                      window.location.href = '/login';
                    }}
                    className="w-full flex items-center justify-center gap-3 text-content-muted hover:text-content font-black transition-colors py-2"
                  >
                    <LogOut size={20} />
                    <span>خروج من النظام</span>
                  </button>
                </div>

                <Branding className="mt-4 opacity-50" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Left Side: Decorative / Vector Illustration */}
        <div className="hidden lg:flex lg:w-1/2 bg-brand relative overflow-hidden items-center justify-center p-12">
          {/* Abstract Background Elements */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-surface/5 rounded-full blur-3xl" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-brand/10 rounded-full blur-3xl" />
          </div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative z-10 text-center text-white w-full max-w-lg"
          >
            {/* Visual Composition: Employees + PIN Pad */}
            <div className="relative h-80 mb-12 flex items-center justify-center">
              {/* Central PIN Pad Vector */}
              <motion.div 
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="w-40 h-56 bg-white/10 backdrop-blur-2xl rounded-[2.5rem] border-2 border-white/20 shadow-2xl p-6 flex flex-col gap-3 relative z-20"
              >
                <div className="grid grid-cols-3 gap-2 flex-1">
                  {[...Array(9)].map((_, i) => (
                    <div key={i} className="bg-white/10 rounded-lg border border-white/5" />
                  ))}
                  <div />
                  <div className="bg-brand/40 rounded-lg border border-white/20" />
                  <div />
                </div>
                <div className="h-4 bg-white/20 rounded-full w-2/3 mx-auto" />
              </motion.div>

              {/* Floating Employee Avatars */}
              <motion.div 
                animate={{ x: [-20, 0, -20], y: [0, -15, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
                className="absolute top-10 left-10 w-20 h-20 bg-success/20 backdrop-blur-xl rounded-3xl border border-white/20 flex items-center justify-center shadow-xl z-30"
              >
                <User size={32} className="text-success-content" />
              </motion.div>

              <motion.div 
                animate={{ x: [20, 0, 20], y: [0, 15, 0] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                className="absolute bottom-10 right-10 w-24 h-24 bg-warning/20 backdrop-blur-xl rounded-[2rem] border border-white/20 flex items-center justify-center shadow-xl z-30"
              >
                <Users size={40} className="text-warning-content" />
              </motion.div>

              <motion.div 
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                className="absolute top-1/2 -right-4 w-16 h-16 bg-brand/30 backdrop-blur-xl rounded-2xl border border-white/20 flex items-center justify-center shadow-xl z-10"
              >
                <Shield size={24} className="text-white/60" />
              </motion.div>

              {/* Connecting Lines (Visualizing Access) */}
              <svg className="absolute inset-0 w-full h-full -z-10 opacity-20" viewBox="0 0 400 300">
                <motion.path 
                  d="M 100 80 Q 200 150 200 150" 
                  stroke="white" strokeWidth="2" fill="none" strokeDasharray="5,5"
                  animate={{ strokeDashoffset: [0, -20] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                />
                <motion.path 
                  d="M 300 220 Q 200 150 200 150" 
                  stroke="white" strokeWidth="2" fill="none" strokeDasharray="5,5"
                  animate={{ strokeDashoffset: [0, -20] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                />
              </svg>
            </div>

            <h1 className="text-5xl font-black mb-6 leading-tight">بوابة الموظفين<br />الذكية</h1>
            <p className="text-white/80 text-xl font-medium max-w-md mx-auto leading-relaxed opacity-80">
              وصول سريع وآمن لكل أفراد فريق العمل باستخدام رمز الدخول الخاص بك.
            </p>
            
            <div className="mt-12 flex flex-wrap items-center justify-center gap-6">
              <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full border border-white/10">
                <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
                <span className="text-xs font-bold text-white/80 uppercase tracking-widest">نظام نشط</span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full border border-white/10">
                <Shield size={14} className="text-white/60" />
                <span className="text-xs font-bold text-white/80 uppercase tracking-widest">حماية متطورة</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
