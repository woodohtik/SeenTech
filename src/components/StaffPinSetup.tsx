import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Shield, Lock, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { Staff, AuditLog } from '../types';
import { hashPin } from '../services/staffService';
import { cn } from '../lib/utils';
import { logEmployeeAction } from '../services/employeeAuditService';

interface StaffPinSetupProps {
  staff: Staff;
  onSuccess: (updatedStaff: Staff) => void;
}

export default function StaffPinSetup({ staff, onSuccess }: StaffPinSetupProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const validatePin = () => {
    const weakPins = ['1234', '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1212', '2580'];
    
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
    if (!validatePin()) return;

    setLoading(true);
    setError(null);

    try {
      const hashedPin = await hashPin(pin);
      const { error: updateError } = await supabase
        .from('staff')
        .update({
          pin_hash: hashedPin,
          must_change_pin: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', staff.id);
      
      if (updateError) throw updateError;

      // Trigger global refresh
      if ((window as any).refreshAuthData) {
        (window as any).refreshAuthData();
      }

      // Audit Log using existing service
      await logEmployeeAction(
        staff.tenantId || (staff as any).tenant_id,
        staff.id,
        staff.name,
        'security',
        `قام الموظف ${staff.name} بتعيين رمز الدخول الخاص به لأول مرة`
      );

      onSuccess({ ...staff, pin: hashedPin, must_change_pin: false } as any);
    } catch (err) {
      console.error('Error setting PIN:', err);
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
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-white flex items-center justify-center p-6 font-sans" dir="rtl">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-[3rem] shadow-2xl border border-gray-100 p-10 flex flex-col items-center"
      >
        <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center text-indigo-600 mb-6 shadow-inner">
          <Shield size={40} />
        </div>

        <h2 className="text-3xl font-black text-gray-900 mb-2 text-center">تعيين رمز الدخول</h2>
        <p className="text-gray-500 text-sm mb-10 text-center font-medium">
          أهلاً بك {staff.name}! يرجى تعيين رمز دخول مكون من 4 أرقام لاستخدام النظام بسرعة وأمان.
        </p>

        <form onSubmit={handleSubmit} className="w-full space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest mr-2 flex items-center gap-2">
              <Lock size={14} />
              رمز الدخول الجديد
            </label>
            <input 
              type="password"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className={cn(
                "w-full bg-gray-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl p-4 text-center text-2xl font-black tracking-[1em] outline-none transition-all",
                error && "border-red-100 bg-red-50"
              )}
              placeholder="****"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest mr-2 flex items-center gap-2">
              <CheckCircle2 size={14} />
              تأكيد الرمز
            </label>
            <input 
              type="password"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              className={cn(
                "w-full bg-gray-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl p-4 text-center text-2xl font-black tracking-[1em] outline-none transition-all",
                error && "border-red-100 bg-red-50"
              )}
              placeholder="****"
              required
            />
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2 text-red-500 text-xs font-bold bg-red-50 px-4 py-3 rounded-xl border border-red-100"
            >
              <AlertCircle size={16} />
              <span>{error}</span>
            </motion.div>
          )}

          <button 
            type="submit"
            disabled={loading || pin.length !== 4 || confirmPin.length !== 4}
            className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                <span>جاري الحفظ...</span>
              </>
            ) : (
              <span>تأكيد الرمز السري</span>
            )}
          </button>
        </form>

        <div className="mt-8 p-4 bg-gray-50 rounded-2xl w-full">
          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">نصائح للأمان:</h4>
          <ul className="text-[10px] text-gray-500 space-y-1 font-bold">
            <li>• تجنب استخدام أرقام متسلسلة (مثل 1234)</li>
            <li>• تجنب استخدام أرقام مكررة (مثل 1111)</li>
            <li>• لا تشارك رمز الدخول الخاص بك مع أي شخص آخر</li>
          </ul>
        </div>
      </motion.div>
    </div>
  );
}
