import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, Delete, Shield, AlertCircle, Loader2 } from 'lucide-react';
import { Staff } from '../types';
import bcrypt from 'bcryptjs';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase/client';
import { logEmployeeAction } from '../services/employeeAuditService';

interface LockScreenProps {
  currentStaff: Staff | null;
  onUnlock: () => void;
  tenantId?: string;
  onUnlockWithStaff?: (staff: Staff) => void;
}

export default function LockScreen({ currentStaff, onUnlock, tenantId, onUnlockWithStaff }: LockScreenProps) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [staffList, setStaffList] = useState<Staff[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    const fetchStaff = async () => {
      try {
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
          const formattedStaff = staffData.map(d => {
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
          });
          setStaffList(formattedStaff);
        }
      } catch (err) {
        console.error('[LockScreen] Error fetching staff list:', err);
      }
    };
    fetchStaff();
  }, [tenantId]);

  const handleNumberClick = (num: string) => {
    if (pin.length < 4) {
      setPin(prev => prev + num);
      setError(null);
      setActiveKey(num);
      setTimeout(() => setActiveKey(null), 100);
    }
  };

  const handleDelete = () => {
    if (pin.length > 0) {
      setPin(prev => prev.slice(0, -1));
      setError(null);
      setActiveKey('Backspace');
      setTimeout(() => setActiveKey(null), 100);
    }
  };

  const handleClear = () => {
    setPin('');
    setError(null);
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
    if (pin.length === 4) {
      const verify = async () => {
        setIsVerifying(true);
        setError(null);
        try {
          if (staffList.length > 0) {
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
              if (currentStaff && matchedStaff.id === currentStaff.id) {
                onUnlock();
              } else {
                if (onUnlockWithStaff) {
                  onUnlockWithStaff(matchedStaff);
                } else {
                  onUnlock();
                }
                // Log audit action for employee unlocking & switching
                logEmployeeAction(
                  tenantId || matchedStaff.tenantId || '',
                  matchedStaff.id,
                  matchedStaff.name,
                  'login',
                  'تسجيل الدخول للنظام بعد إلغاء القفل (PIN)'
                ).catch(() => {});
              }
            } else {
              setError(t('common.invalid_pin', 'رمز الدخول غير صحيح'));
              setPin('');
            }
          } else {
            // Fallback to only checks currentStaff code
            if (!currentStaff) {
              // Decoupled or missing staff session context, clear lock
              onUnlock();
              return;
            }
            const isMatch = await bcrypt.compare(pin, currentStaff.pin || '');
            if (isMatch) {
              onUnlock();
            } else {
              setError(t('common.invalid_pin', 'رمز الدخول غير صحيح'));
              setPin('');
            }
          }
        } catch (err) {
          console.error('[LockScreen] Error verifying lock pin:', err);
          setError(t('common.error_verifying', 'حدث خطأ أثناء التحقق'));
          setPin('');
        } finally {
          setIsVerifying(false);
        }
      };
      verify();
    }
  }, [pin, staffList, currentStaff, onUnlock, onUnlockWithStaff, tenantId, t]);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/95 backdrop-blur-2xl text-white overflow-y-auto p-4 select-none" dir="rtl">
      {/* Decorative ambient blobs */}
      <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-brand/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-[#EF4444]/5 rounded-full blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md flex flex-col items-center text-center space-y-8 z-10"
      >
        {/* Status Indicator */}
        <div className="relative">
          <div className="w-20 h-20 bg-brand/10 border border-brand/20 rounded-[2rem] flex items-center justify-center text-brand relative shadow-[0_0_50px_-12px_rgba(28,143,255,0.3)]">
            {isVerifying ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : (
              <Lock className="w-8 h-8" />
            )}
          </div>
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500"></span>
          </span>
        </div>

        {/* User identification */}
        <div className="space-y-2">
          <h2 className="text-2xl font-black tracking-tight text-white/90">
            {currentStaff ? currentStaff.name : t('common.user', 'المستخدم')}
          </h2>
          <p className="text-sm font-bold text-brand uppercase tracking-widest">
            {t('common.screen_locked', 'النظام مقفل حالياً')}
          </p>
        </div>

        {/* Mask dots indicator */}
        <div className="flex gap-4 my-6 justify-center">
          {[1, 2, 3, 4].map((index) => (
            <motion.div
              key={index}
              animate={{
                scale: pin.length >= index ? [1, 1.2, 1] : 1,
                backgroundColor: pin.length >= index ? '#1C8FFF' : 'rgba(255, 255, 255, 0.1)',
                borderColor: pin.length >= index ? '#1C8FFF' : 'rgba(255, 255, 255, 0.2)'
              }}
              className="w-4 h-4 rounded-full border transition-all duration-200 shadow-sm"
              style={{ boxShadow: pin.length >= index ? '0 0 12px #1C8FFF' : 'none' }}
            />
          ))}
        </div>

        {/* Dynamic Error notification */}
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold rounded-2xl flex items-center gap-2"
            >
              <AlertCircle size={14} />
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Secure Keypad Grid */}
        <div className="grid grid-cols-3 gap-4 w-full px-6 max-w-[340px]">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => handleNumberClick(num)}
              className={cn(
                "h-16 rounded-2xl bg-white/5 border border-white/10 text-xl font-bold flex items-center justify-center transition-all min-h-[44px]",
                "hover:bg-white/10 active:scale-95 active:bg-white/15 cursor-pointer touch-manipulation focus:outline-none",
                activeKey === num && "bg-white/25 scale-95 border-brand"
              )}
            >
              {num}
            </button>
          ))}
          
          <button
            type="button"
            onClick={handleClear}
            className="h-16 rounded-2xl text-xs font-bold text-white/40 hover:text-white flex items-center justify-center transition-all cursor-pointer min-h-[44px] focus:outline-none"
          >
            {t('common.clear', 'مسح')}
          </button>
          
          <button
            type="button"
            onClick={() => handleNumberClick('0')}
            className={cn(
              "h-16 rounded-2xl bg-white/5 border border-white/10 text-xl font-bold flex items-center justify-center transition-all min-h-[44px]",
              "hover:bg-white/10 active:scale-95 active:bg-white/15 cursor-pointer touch-manipulation focus:outline-none",
              activeKey === '0' && "bg-white/25 scale-95 border-brand"
            )}
          >
            0
          </button>
          
          <button
            type="button"
            onClick={handleDelete}
            className={cn(
              "h-16 rounded-2xl bg-white/5 border border-white/10 text-white flex items-center justify-center transition-all min-h-[44px]",
              "hover:bg-white/10 active:scale-95 active:bg-white/15 cursor-pointer touch-manipulation focus:outline-none",
              activeKey === 'Backspace' && "bg-white/25 scale-95 border-brand"
            )}
          >
            <Delete size={20} className="text-white/60" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
