import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Shield, Lock, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { Staff, AuditLog } from '../types';
import { hashPin } from '../services/staffService';
import { cn } from '../lib/utils';
import { logEmployeeAction } from '../services/employeeAuditService';
import { useDirection } from '../lib/direction';

interface StaffPinSetupProps {
  staff: Staff;
  onSuccess: (updatedStaff: Staff) => void;
}

export default function StaffPinSetup({ staff, onSuccess }: StaffPinSetupProps) {
  const { t, dir } = useDirection();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const validatePin = () => {
    if (pin.length !== 4) {
      setError(t('staff.pin_must_be_four_digits'));
      return false;
    }
    if (pin !== confirmPin) {
      setError(t('staff.pin_mismatch'));
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
      let errMessage = t('orders.unknown_error');
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
      setError(t('staff.pin_setup_error', { message: errMessage }));
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    setLoading(true);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from('staff')
        .update({
          pin_hash: null,
          must_change_pin: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', staff.id);
      
      if (updateError) throw updateError;

      // Trigger global refresh
      if ((window as any).refreshAuthData) {
        (window as any).refreshAuthData();
      }

      // Audit Log
      await logEmployeeAction(
        staff.tenantId || (staff as any).tenant_id,
        staff.id,
        staff.name,
        'security',
        `اختار الموظف ${staff.name} عدم استخدام رمز دخول`
      );

      onSuccess({ ...staff, pin: null, must_change_pin: false } as any);
    } catch (err) {
      console.error('Error skipping PIN:', err);
      setError(t('staff.pin_skip_error'));
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-surface flex items-center justify-center p-6 font-sans" dir={dir}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-surface rounded-3xl shadow-xl border border-border p-8 flex flex-col items-center"
      >
        <div className="w-16 h-16 bg-brand/10 rounded-2xl flex items-center justify-center text-brand mb-6">
          <Shield size={32} />
        </div>

        <h2 className="text-2xl font-black text-content mb-2 text-center">{t('staff.pin_setup_title')}</h2>
        <p className="text-content-muted text-sm mb-8 text-center">
          {t('staff.pin_setup_intro', { name: staff.name })}
        </p>

        <form onSubmit={handleSubmit} className="w-full space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-bold text-content-muted flex items-center gap-2">
              <Lock size={14} />
              {t('staff.pin_new')}
            </label>
            <input
              type="password"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className={cn(
                "w-full bg-surface-muted border border-border rounded-xl p-3 text-center text-xl font-bold tracking-[0.5em] outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand",
                error && "border-danger bg-danger/5"
              )}
              placeholder="****"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-content-muted flex items-center gap-2">
              <CheckCircle2 size={14} />
              {t('staff.pin_confirm')}
            </label>
            <input
              type="password"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              className={cn(
                "w-full bg-surface-muted border border-border rounded-xl p-3 text-center text-xl font-bold tracking-[0.5em] outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand",
                error && "border-danger bg-danger/5"
              )}
              placeholder="****"
              required
            />
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2 text-danger text-xs font-bold bg-danger/10 px-4 py-3 rounded-lg border border-danger/20"
            >
              <AlertCircle size={16} />
              <span>{error}</span>
            </motion.div>
          )}

          <div className="flex flex-col gap-3 pt-2">
            <button 
              type="submit"
              disabled={loading || pin.length !== 4 || confirmPin.length !== 4}
              className="w-full bg-brand text-white py-3.5 rounded-xl font-bold hover:bg-brand/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>{t('common.saving')}</span>
                </>
              ) : (
                <span>{t('staff.pin_confirm')}</span>
              )}
            </button>
            <button
              type="button"
              onClick={handleSkip}
              disabled={loading}
              className="w-full bg-surface-muted text-content py-3.5 rounded-xl font-bold hover:bg-surface transition-all disabled:opacity-50"
            >
              {t('staff.pin_skip')}
            </button>
          </div>
        </form>

        <div className="mt-6 p-4 bg-surface-muted rounded-xl w-full">
          <h4 className="text-xs font-bold text-content-muted mb-2">{t('staff.pin_security_tips')}</h4>
          <ul className="text-xs text-content-muted space-y-1">
            <li>• {t('staff.pin_tip_no_sequences')}</li>
            <li>• {t('staff.pin_tip_no_repeats')}</li>
            <li>• {t('staff.pin_tip_do_not_share')}</li>
          </ul>
        </div>
      </motion.div>
    </div>
  );
}
