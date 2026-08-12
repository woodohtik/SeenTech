import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, ShoppingCart, CreditCard, CheckCircle, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useDirection } from '../lib/direction';

export default function StaffTutorialModal({ role }: { role?: string | null }) {
  const { t, dir } = useDirection();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (role === 'staff') {
      const isDismissed = localStorage.getItem('staff_tutorial_dismissed');
      if (!isDismissed) {
        setIsOpen(true);
      }
    }
  }, [role]);

  const handleDismiss = () => {
    localStorage.setItem('staff_tutorial_dismissed', 'true');
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" dir={dir}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="bg-surface w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden relative border border-border flex flex-col"
        >
          <div className="p-6 border-b border-border flex justify-between items-center bg-surface-muted">
            <h2 className="text-xl font-bold text-content flex items-center gap-2">
              <CheckCircle className="text-brand" /> {t('staff.tutorial_title')}
            </h2>
            <button
              onClick={handleDismiss}
              className="p-2 hover:bg-surface-muted/50 rounded-full text-content-muted transition-colors"
            >
              <X size={20} />
            </button>
          </div>
          
          <div className="p-8 space-y-8">
            <p className="text-content-muted text-sm leading-relaxed mb-6">
              {t('staff.tutorial_intro')}
            </p>

            <div className="grid gap-6 md:grid-cols-3">
              <div className="bg-surface-muted/30 p-5 rounded-2xl border border-border flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-blue-500/10 text-blue-500 rounded-xl flex items-center justify-center mb-4">
                  <Users size={24} />
                </div>
                <h3 className="font-bold text-content mb-2">{t('staff.tutorial_step1_title')}</h3>
                <p className="text-xs text-content-muted">{t('staff.tutorial_step1_desc')}</p>
              </div>

              <div className="bg-surface-muted/30 p-5 rounded-2xl border border-border flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-brand/10 text-brand rounded-xl flex items-center justify-center mb-4">
                  <ShoppingCart size={24} />
                </div>
                <h3 className="font-bold text-content mb-2">{t('staff.tutorial_step2_title')}</h3>
                <p className="text-xs text-content-muted">{t('staff.tutorial_step2_desc')}</p>
              </div>

              <div className="bg-surface-muted/30 p-5 rounded-2xl border border-border flex flex-col items-center text-center">
                <div className="w-12 h-12 bg-emerald-500/10 text-emerald-500 rounded-xl flex items-center justify-center mb-4">
                  <CreditCard size={24} />
                </div>
                <h3 className="font-bold text-content mb-2">{t('staff.tutorial_step3_title')}</h3>
                <p className="text-xs text-content-muted">{t('staff.tutorial_step3_desc')}</p>
              </div>
            </div>
          </div>

          <div className="p-6 border-t border-border bg-surface-muted flex justify-end gap-3">
            <button
              onClick={handleDismiss}
              className="px-6 py-2.5 bg-brand text-white rounded-xl font-bold text-sm hover:bg-brand-dark transition-colors"
            >
              {t('staff.tutorial_got_it')}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
