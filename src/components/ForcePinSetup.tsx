import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, Shield, AlertCircle, CheckCircle2, ArrowLeft, Loader2, Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { hashPin } from '../services/staffService';
import { cn } from '../lib/utils';
import { AuditLog } from '../types';
import { logEmployeeAction } from '../services/employeeAuditService';
import { useAuth } from '../contexts/AuthContext';
import { useDirection } from '../lib/direction';

interface ForcePinSetupProps {
  tenantId: string;
  onSuccess: () => void;
}

export default function ForcePinSetup({ tenantId, onSuccess }: ForcePinSetupProps) {
  const { t, dir } = useDirection();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [enablePin, setEnablePin] = useState(true);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const validatePin = () => {
    if (!enablePin) return true;
    if (pin.length !== 4) {
      setError(t('staff.force_pin.pin_must_be_4_digits'));
      return false;
    }
    if (pin !== confirmPin) {
      setError(t('staff.force_pin.pins_do_not_match'));
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validatePin()) return;
    if (!tenantId || tenantId === 'null') {
      setError(t('staff.force_pin.invalid_tenant_id'));
      return;
    }

    setLoading(true);
    try {
      const hashedPin = enablePin ? await hashPin(pin) : null;
      
      const { data: tenantData, error: tenantError } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .single();
      
      if (tenantError) throw tenantError;

      if (!currentUser) throw new Error("No authenticated user found");

      // Check if this user already has a staff record
      const { data: existingStaff, error: existingStaffError } = await supabase
        .from('staff')
        .select('*')
        .eq('uid', currentUser.id)
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
            uid: currentUser.id,
            name: currentUser.user_metadata?.full_name || tenantData?.name || 'موظف جديد',
            email: currentUser.email || tenantData?.owner_email || '',
            phone: currentUser.phone || tenantData?.phone || '',
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
          enablePin 
            ? `تم إكمال إعداد الرمز السري (${usedRole === 'owner' ? 'المالك' : 'موظف'}) بنجاح`
            : `تم تخطي إعداد رمز الدخول للموظفين وتعطيله`
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
      let errMessage = t('staff.force_pin.unknown_error');
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
      setError(t('staff.force_pin.error_with_message', { message: errMessage }));
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-slate-50/90 backdrop-blur-sm flex items-center justify-center p-4 font-sans" dir={dir}>
      <motion.div 
        initial={{ opacity: 0, y: 15, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden"
      >
        {/* Header - More elegant and integrated */}
        <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 px-6 py-8 text-white text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-xl" />
          <div className="relative z-10 space-y-3">
            <div className="w-14 h-14 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center mx-auto border border-white/20 shadow-md">
              <Shield size={28} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{t('staff.force_pin.title')}</h1>
              <p className="text-xs text-indigo-100/90 mt-1">{t('staff.force_pin.subtitle')}</p>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            {success ? (
              <motion.div 
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-6 space-y-4"
              >
                <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto border border-emerald-100">
                  <CheckCircle2 size={36} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">{t('staff.force_pin.success_title')}</h2>
                  <p className="text-xs text-slate-500 mt-1">{t('staff.force_pin.success_desc')}</p>
                </div>
              </motion.div>
            ) : (
              <motion.form 
                key="form"
                onSubmit={handleSubmit}
                className="space-y-5"
              >
                {/* Enable PIN Toggle option - beautiful card layout */}
                <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-100 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <label htmlFor="enable_pin_toggle" className="text-sm font-bold text-slate-700 cursor-pointer">{t('staff.force_pin.enable_toggle')}</label>
                    <p className="text-xs text-slate-400">{t('staff.force_pin.enable_toggle_desc')}</p>
                  </div>
                  <button
                    id="enable_pin_toggle"
                    type="button"
                    onClick={() => {
                      setEnablePin(!enablePin);
                      setError(null);
                    }}
                    className={cn(
                      "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      enablePin ? "bg-indigo-600" : "bg-slate-200"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                        enablePin ? "-translate-x-5" : "translate-x-0"
                      )}
                    />
                  </button>
                </div>

                {/* Input Fields Container with comfortable sizing */}
                {enablePin && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-4 overflow-hidden"
                  >
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center px-1">
                        <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                          <Lock size={14} className="text-indigo-500" />
                          {t('staff.force_pin.new_pin_label')}
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowPin(!showPin)}
                          className="text-xs text-slate-400 hover:text-indigo-600 transition-colors flex items-center gap-1"
                        >
                          {showPin ? <EyeOff size={13} /> : <Eye size={13} />}
                          <span>{showPin ? t('common.hide') : t('common.show')}</span>
                        </button>
                      </div>
                      <input 
                        type={showPin ? "text" : "password"}
                        maxLength={4}
                        pattern="\d*"
                        value={pin}
                        onChange={(e) => {
                          setPin(e.target.value.replace(/\D/g, ''));
                          setError(null);
                        }}
                        className={cn(
                          "w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded-xl p-3 text-center text-xl font-bold tracking-[0.5em] outline-none transition-all",
                          error && "border-red-300 bg-red-50/30"
                        )}
                        placeholder="••••"
                        autoFocus
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-600 mr-1 flex items-center gap-1.5">
                        <CheckCircle2 size={14} className="text-indigo-500" />
                        {t('staff.force_pin.confirm_pin_label')}
                      </label>
                      <input 
                        type={showPin ? "text" : "password"}
                        maxLength={4}
                        pattern="\d*"
                        value={confirmPin}
                        onChange={(e) => {
                          setConfirmPin(e.target.value.replace(/\D/g, ''));
                          setError(null);
                        }}
                        className={cn(
                          "w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white rounded-xl p-3 text-center text-xl font-bold tracking-[0.5em] outline-none transition-all",
                          error && "border-red-300 bg-red-50/30"
                        )}
                        placeholder="••••"
                      />
                    </div>
                  </motion.div>
                )}

                {/* Error Banner */}
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-2.5 text-red-600 text-xs font-semibold bg-red-50 p-3 rounded-xl border border-red-100/50"
                  >
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                  </motion.div>
                )}

                {/* Action Button */}
                <button 
                  type="submit"
                  disabled={loading || (enablePin && (pin.length !== 4 || confirmPin.length !== 4))}
                  className="w-full bg-indigo-600 text-white py-3 px-4 rounded-xl font-bold text-sm hover:bg-indigo-700 shadow-md hover:shadow-indigo-100 transition-all active:scale-98 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="animate-spin" size={18} /> : <Shield size={16} />}
                  <span>{enablePin ? t('staff.force_pin.save_and_enable') : t('staff.force_pin.continue_without_pin')}</span>
                </button>

                <p className="text-center text-[10px] text-slate-400 leading-relaxed px-2">
                  {enablePin
                    ? t('staff.force_pin.note_enabled')
                    : t('staff.force_pin.note_disabled')}
                </p>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
