import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, Shield, AlertCircle, CheckCircle2, ArrowLeft, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { hashPin } from '../services/staffService';
import { cn } from '../lib/utils';
import { AuditLog } from '../types';
import { logEmployeeAction } from '../services/employeeAuditService';
import { auth as firebaseAuth } from '../lib/firebase';

interface ForcePinSetupProps {
  tenantId: string;
  onSuccess: () => void;
}

export default function ForcePinSetup({ tenantId, onSuccess }: ForcePinSetupProps) {
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const weakPins = ['1234', '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1212', '2580'];

  const validatePin = () => {
    if (pin.length !== 4) {
      setError('يجب أن يتكون الرمز من 4 أرقام');
      return false;
    }
    if (pin !== confirmPin) {
      setError('الرمزان غير متطابقين');
      return false;
    }
    if (weakPins.includes(pin)) {
      setError('هذا الرمز ضعيف جداً، يرجى اختيار رمز أكثر تعقيداً');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validatePin()) return;
    if (!tenantId || tenantId === 'null') {
      setError('معرف المشترك غير صالح');
      return;
    }

    setLoading(true);
    try {
      const hashedPin = await hashPin(pin);
      
      const { data: tenantData, error: tenantError } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .single();
      
      if (tenantError) throw tenantError;

      const currentUser = firebaseAuth.currentUser;
      if (!currentUser) throw new Error("No authenticated user found in Firebase");

      // Check if this user already has a staff record
      const { data: existingStaff, error: existingStaffError } = await supabase
        .from('staff')
        .select('*')
        .eq('uid', currentUser.uid)
        .maybeSingle();

      if (existingStaffError) throw existingStaffError;

      let staffData;
      let usedRole = 'cashier';
      
      if (existingStaff) {
        usedRole = existingStaff.role;
        // Update existing record
        const { data: updatedStaff, error: updateError } = await supabase
          .from('staff')
          .update({
            pin_hash: hashedPin,
            must_change_pin: false,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingStaff.id)
          .select()
          .single();
        
        if (updateError) throw updateError;
        staffData = updatedStaff;
      } else {
        // Check if any staff members already exist for this tenant to determine role
        const { count, error: countError } = await supabase
          .from('staff')
          .select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId);
        
        if (countError) throw countError;

        // Logic: First user is owner, subsequent are cashier
        const role = (count === 0) ? 'owner' : 'cashier';
        usedRole = role;

        const { data: newStaff, error: insertError } = await supabase
          .from('staff')
          .insert({
            uid: currentUser.uid,
            name: currentUser.displayName || tenantData?.name || 'موظف جديد',
            email: currentUser.email || tenantData?.owner_email || '',
            phone: currentUser.phoneNumber || tenantData?.phone || '',
            role: role,
            status: 'active',
            pin_hash: hashedPin,
            must_change_pin: false,
            tenant_id: tenantId,
            created_at: new Date().toISOString()
          })
          .select()
          .single();
        
        if (insertError) throw insertError;
        staffData = newStaff;
      }

      setSuccess(true);
      
      const is_onboarding_complete = tenantData?.status === 'active';

      // Update global auth state to reflect new role immediately
      if ((window as any).refreshAuthData) {
        (window as any).refreshAuthData();
      }

      // Log in background
      if (staffData) {
        logEmployeeAction(
          tenantId,
          staffData.id,
          staffData.name,
          'security',
          `تم إكمال إعداد الرمز السري (${usedRole === 'owner' ? 'المالك' : 'موظف'}) بنجاح`
        ).catch(() => {});
      }

      // Explicitly trigger parent update and routing based on onboarding completion status
      setTimeout(() => {
        onSuccess();
        if (is_onboarding_complete) {
          navigate('/dashboard');
        } else {
          navigate('/onboarding');
        }
      }, 1500);
    } catch (err) {
      console.error('Error setting initial PIN:', err);
      let errMessage = 'حدث خطأ غير معروف';
      if (err instanceof Error) {
        errMessage = err.message;
      } else if (typeof err === 'string') {
        errMessage = err;
      } else if (err && typeof err === 'object') {
        try {
          errMessage = JSON.stringify(err);
        } catch (stringificationError) {
          errMessage = (err as any).message || (err as any).name || String(err);
        }
      } else {
        errMessage = String(err);
      }
      setError('حدث خطأ: ' + errMessage);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-gray-50 flex items-center justify-center p-6 font-sans" dir="rtl">
      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-lg bg-white rounded-[3rem] shadow-2xl shadow-indigo-100 overflow-hidden border border-gray-100"
      >
        <div className="bg-indigo-600 p-10 text-white text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
          <div className="relative z-10">
            <div className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-3xl flex items-center justify-center mx-auto mb-6 border border-white/30 shadow-xl">
              <Shield size={40} className="text-white" />
            </div>
            <h1 className="text-3xl font-black mb-2">إعداد الأمان الإلزامي</h1>
            <p className="text-indigo-100 font-medium">يرجى تعيين رمز الدخول السريع الأول للمنشأة</p>
          </div>
        </div>

        <div className="p-10">
          <AnimatePresence mode="wait">
            {success ? (
              <motion.div 
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-8"
              >
                <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 size={48} />
                </div>
                <h2 className="text-2xl font-black text-gray-900 mb-2">تم التعيين بنجاح!</h2>
                <p className="text-gray-500 font-medium">تم تعيين رمز الدخول بنجاح، يمكنك الآن استخدامه للدخول السريع.</p>
              </motion.div>
            ) : (
              <motion.form 
                key="form"
                onSubmit={handleSubmit}
                className="space-y-8"
              >
                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-sm font-black text-gray-700 mr-2 flex items-center gap-2">
                      <Lock size={16} className="text-indigo-600" />
                      أدخل الرمز السري الجديد (4 أرقام)
                    </label>
                    <input 
                      type="password"
                      maxLength={4}
                      value={pin}
                      onChange={(e) => {
                        setPin(e.target.value.replace(/\D/g, ''));
                        setError(null);
                      }}
                      className={cn(
                        "w-full bg-gray-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl p-5 text-center text-3xl font-black tracking-[1em] outline-none transition-all shadow-inner",
                        error && "border-red-200 bg-red-50"
                      )}
                      placeholder="****"
                      autoFocus
                    />
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-black text-gray-700 mr-2 flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-indigo-600" />
                      تأكيد الرمز السري
                    </label>
                    <input 
                      type="password"
                      maxLength={4}
                      value={confirmPin}
                      onChange={(e) => {
                        setConfirmPin(e.target.value.replace(/\D/g, ''));
                        setError(null);
                      }}
                      className={cn(
                        "w-full bg-gray-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl p-5 text-center text-3xl font-black tracking-[1em] outline-none transition-all shadow-inner",
                        error && "border-red-200 bg-red-50"
                      )}
                      placeholder="****"
                    />
                  </div>
                </div>

                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 text-red-600 text-sm font-bold bg-red-50 p-4 rounded-2xl border border-red-100"
                  >
                    <AlertCircle size={20} />
                    <span>{error}</span>
                  </motion.div>
                )}

                <button 
                  type="submit"
                  disabled={loading || pin.length !== 4 || confirmPin.length !== 4}
                  className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black text-lg hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  {loading ? <Loader2 className="animate-spin" /> : <Shield size={24} />}
                  <span>حفظ وتفعيل الرمز</span>
                </button>

                <p className="text-center text-xs text-gray-400 font-medium leading-relaxed px-4">
                  ملاحظة: هذا الرمز سيستخدم للدخول السريع لجميع موظفي المنشأة. يرجى التأكد من حفظه جيداً.
                </p>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
